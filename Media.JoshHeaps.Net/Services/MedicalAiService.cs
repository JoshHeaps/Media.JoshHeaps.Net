using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Media.JoshHeaps.Net.Services;

public class MedicalAiService
{
    private readonly HttpClient _httpClient;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MedicalAiService> _logger;
    private readonly string? _apiKey;

    private const string HaikuModel = "claude-haiku-4-5-20251001";
    private const string SonnetModel = "claude-sonnet-4-5-20250929";

    public MedicalAiService(IConfiguration configuration, IServiceScopeFactory scopeFactory, ILogger<MedicalAiService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _apiKey = configuration["Anthropic:ApiKey"];

        _httpClient = new HttpClient
        {
            BaseAddress = new Uri("https://api.anthropic.com")
        };
        _httpClient.DefaultRequestHeaders.Add("x-api-key", _apiKey ?? "");
        _httpClient.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
    }

    public void EnqueueProcessing(long documentId)
    {
        if (string.IsNullOrEmpty(_apiKey))
        {
            _logger.LogWarning("Anthropic API key not configured, skipping AI processing for document {DocumentId}", documentId);
            return;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var medicalDocsService = scope.ServiceProvider.GetRequiredService<MedicalDocsService>();
                await ProcessDocumentAsync(documentId, medicalDocsService);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Background AI processing failed for document {DocumentId}", documentId);
            }
        });
    }

    private async Task ProcessDocumentAsync(long documentId, MedicalDocsService medicalDocsService)
    {
        _logger.LogInformation("Starting AI processing for document {DocumentId}", documentId);

        var doc = await medicalDocsService.GetDocumentByIdAsync(documentId);
        if (doc == null)
        {
            _logger.LogWarning("Document {DocumentId} not found for AI processing", documentId);
            return;
        }

        var aiResponses = new Dictionary<string, object>();

        // Step 1: Text extraction
        string? extractedText = null;

        if (doc.DocumentType == "note")
        {
            extractedText = doc.Description;
        }
        else if (doc.DocumentType == "file")
        {
            var fileData = await medicalDocsService.GetDecryptedDocumentDataAsync(documentId);
            if (fileData != null && doc.MimeType != null)
            {
                extractedText = await ExtractTextAsync(fileData, doc.MimeType);
                if (extractedText != null)
                    aiResponses["extraction"] = new { model = HaikuModel, text = extractedText };
            }
        }

        if (string.IsNullOrWhiteSpace(extractedText))
        {
            _logger.LogWarning("No text could be extracted from document {DocumentId}", documentId);
            extractedText = doc.Title ?? doc.FileName ?? "";
        }

        // Step 2: Classification + tagging (Haiku)
        string? classification = doc.Classification;
        List<string> tags = [];

        try
        {
            var classResult = await ClassifyAndTagAsync(extractedText);
            if (classResult != null)
            {
                classification = classResult.Classification ?? classification;
                tags = classResult.Tags ?? [];
                aiResponses["classification"] = classResult;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Classification failed for document {DocumentId}", documentId);
        }

        // Step 3: Structured data extraction (Sonnet)
        StructuredExtractionResult? structuredData = null;

        try
        {
            structuredData = await ExtractStructuredDataAsync(extractedText, classification ?? "other");
            if (structuredData != null)
                aiResponses["structured"] = structuredData;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Structured extraction failed for document {DocumentId}", documentId);
        }

        // Step 4: Persist results
        var rawResponse = JsonSerializer.Serialize(aiResponses, JsonOpts);

        await medicalDocsService.UpdateAiResultsAsync(documentId, extractedText, classification, rawResponse);

        if (tags.Count > 0)
            await medicalDocsService.AddTagsAsync(documentId, tags);

        if (structuredData?.Costs is { Count: > 0 })
            await medicalDocsService.AddCostsAsync(documentId, doc.PersonId, structuredData.Costs);

        _logger.LogInformation("AI processing complete for document {DocumentId}: classification={Classification}, tags={TagCount}, costs={CostCount}",
            documentId, classification, tags.Count, structuredData?.Costs?.Count ?? 0);
    }

    private async Task<string?> ExtractTextAsync(byte[] fileData, string mimeType)
    {
        _logger.LogInformation("Extracting text via Haiku vision, mimeType={MimeType}, size={Size}KB", mimeType, fileData.Length / 1024);

        var isImage = mimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        var isPdf = mimeType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase);

        if (!isImage && !isPdf)
        {
            _logger.LogInformation("Unsupported mime type {MimeType} for vision extraction", mimeType);
            return null;
        }

        var base64Data = Convert.ToBase64String(fileData);

        var mediaType = isPdf ? "application/pdf" : mimeType;
        var sourceType = isPdf ? "base64" : "base64";

        var content = new List<object>
        {
            new
            {
                type = "image",
                source = new
                {
                    type = sourceType,
                    media_type = mediaType,
                    data = base64Data
                }
            },
            new
            {
                type = "text",
                text = "Extract all text from this medical document. Include all visible text, numbers, dates, names, and amounts. Preserve the structure and formatting as much as possible. If the document is handwritten, do your best to transcribe it. Return only the extracted text, no commentary."
            }
        };

        var response = await CallClaudeAsync(HaikuModel, content, "You are an OCR assistant. Extract text from medical documents accurately and completely.");

        return response;
    }

    private async Task<ClassificationResult?> ClassifyAndTagAsync(string text)
    {
        _logger.LogInformation("Classifying and tagging via Haiku");

        var truncatedText = text.Length > 4000 ? text[..4000] : text;

        var content = new List<object>
        {
            new
            {
                type = "text",
                text = $"Analyze this medical document text and classify it.\n\nDocument text:\n{truncatedText}"
            }
        };

        var systemPrompt = @"You are a medical document classifier. Analyze the document text and return a JSON object with:
- ""classification"": one of: receipt, lab_result, prescription, imaging, dr_note, insurance, referral, discharge, recording, other
- ""tags"": array of relevant tag strings (lowercase, e.g. ""blood work"", ""cardiology"", ""annual physical"", ""copay"")

Return ONLY the JSON object, no other text.";

        var response = await CallClaudeAsync(HaikuModel, content, systemPrompt);

        if (response == null) return null;

        // Parse JSON from response - handle potential markdown wrapping
        var json = ExtractJson(response);

        try
        {
            return JsonSerializer.Deserialize<ClassificationResult>(json, JsonOpts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse classification response: {Response}", response);
            return null;
        }
    }

    private async Task<StructuredExtractionResult?> ExtractStructuredDataAsync(string text, string classification)
    {
        _logger.LogInformation("Extracting structured data via Sonnet, classification={Classification}", classification);

        var truncatedText = text.Length > 6000 ? text[..6000] : text;

        var content = new List<object>
        {
            new
            {
                type = "text",
                text = $"Classification: {classification}\n\nDocument text:\n{truncatedText}"
            }
        };

        var systemPrompt = @"You are a medical document data extractor. Extract financial and medical data from the document.

Return a JSON object with:
- ""costs"": array of cost objects, each with: ""amount"" (number), ""costType"" (string: copay, deductible, out_of_pocket, coinsurance, premium, total_charge, other), ""category"" (string: office_visit, lab, pharmacy, imaging, therapy, hospital, specialist, other), ""date"" (string, YYYY-MM-DD or null), ""description"" (string)
- ""doctorName"": string or null - the name of the doctor/provider mentioned
- ""prescriptionInfo"": object or null with ""medicationName"", ""dosage"", ""frequency"" fields

Only include fields you can confidently extract from the text. If no costs are found, return an empty costs array. Return ONLY the JSON object, no other text.";

        var response = await CallClaudeAsync(SonnetModel, content, systemPrompt);

        if (response == null) return null;

        var json = ExtractJson(response);

        try
        {
            return JsonSerializer.Deserialize<StructuredExtractionResult>(json, JsonOpts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse structured extraction response: {Response}", response);
            return null;
        }
    }

    private async Task<string?> CallClaudeAsync(string model, List<object> content, string systemPrompt)
    {
        var requestBody = new
        {
            model,
            max_tokens = 4096,
            system = systemPrompt,
            messages = new[]
            {
                new
                {
                    role = "user",
                    content
                }
            }
        };

        var json = JsonSerializer.Serialize(requestBody, JsonOpts);
        var httpContent = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync("/v1/messages", httpContent);

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync();
            _logger.LogError("Claude API error {StatusCode}: {Error}", response.StatusCode, errorBody);
            return null;
        }

        var responseJson = await response.Content.ReadAsStringAsync();
        var result = JsonSerializer.Deserialize<ClaudeResponse>(responseJson, JsonOpts);

        var textBlock = result?.Content?.FirstOrDefault(c => c.Type == "text");
        return textBlock?.Text;
    }

    private static string ExtractJson(string response)
    {
        // Handle markdown code blocks
        var trimmed = response.Trim();
        if (trimmed.StartsWith("```"))
        {
            var firstNewline = trimmed.IndexOf('\n');
            if (firstNewline >= 0)
            {
                trimmed = trimmed[(firstNewline + 1)..];
                var lastFence = trimmed.LastIndexOf("```");
                if (lastFence >= 0)
                    trimmed = trimmed[..lastFence];
            }
        }
        return trimmed.Trim();
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    // --- Response DTOs ---

    private class ClaudeResponse
    {
        public List<ContentBlock>? Content { get; set; }
    }

    private class ContentBlock
    {
        public string Type { get; set; } = "";
        public string? Text { get; set; }
    }

    public class ClassificationResult
    {
        public string? Classification { get; set; }
        public List<string>? Tags { get; set; }
    }

    public class StructuredExtractionResult
    {
        public List<CostExtraction>? Costs { get; set; }
        public string? DoctorName { get; set; }
        public PrescriptionInfo? PrescriptionInfo { get; set; }
    }

    public class CostExtraction
    {
        public decimal Amount { get; set; }
        public string? CostType { get; set; }
        public string? Category { get; set; }
        public string? Date { get; set; }
        public string? Description { get; set; }
    }

    public class PrescriptionInfo
    {
        public string? MedicationName { get; set; }
        public string? Dosage { get; set; }
        public string? Frequency { get; set; }
    }
}
