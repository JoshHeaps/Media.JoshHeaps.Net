using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Channels;

namespace Media.JoshHeaps.Net.Services;

public class MedicalAiService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MedicalAiService> _logger;
    private readonly Channel<long> _queue = Channel.CreateUnbounded<long>();
    private DateTime? _rateLimitResetTime;

    private const string HaikuModel = "claude-haiku-4-5-20251001";
    private const string SonnetModel = "claude-sonnet-4-5-20250929";

    public MedicalAiService(IServiceScopeFactory scopeFactory, ILogger<MedicalAiService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _ = Task.Run(ProcessQueueAsync);
    }

    public void EnqueueProcessing(long documentId)
    {
        _queue.Writer.TryWrite(documentId);
        _logger.LogInformation("Enqueued document {DocumentId} for AI processing", documentId);
    }

    private async Task ProcessQueueAsync()
    {
        await foreach (var documentId in _queue.Reader.ReadAllAsync())
        {
            if (_rateLimitResetTime.HasValue && _rateLimitResetTime.Value > DateTime.UtcNow)
            {
                var delay = _rateLimitResetTime.Value - DateTime.UtcNow;
                _logger.LogInformation("Rate limited, waiting {Delay} until {ResetTime}", delay, _rateLimitResetTime.Value);
                await Task.Delay(delay);
                _rateLimitResetTime = null;
            }

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var medicalDocsService = scope.ServiceProvider.GetRequiredService<MedicalDocsService>();
                await ProcessDocumentAsync(documentId, medicalDocsService);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "AI processing failed for document {DocumentId}", documentId);
            }
        }
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

        // Step 1: Text extraction (Haiku)
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
                extractedText = await ExtractTextAsync(fileData, doc.MimeType, doc.FileName);
                if (IsRateLimited) { _queue.Writer.TryWrite(documentId); return; }
                if (extractedText != null)
                    aiResponses["extraction"] = new { model = HaikuModel, text = extractedText };
            }
        }

        if (string.IsNullOrWhiteSpace(extractedText))
        {
            _logger.LogWarning("No text could be extracted from document {DocumentId}", documentId);
            extractedText = doc.Title ?? doc.FileName ?? "";
        }

        // Step 2: Classification + tagging + doctor name (Haiku)
        string? classification = doc.Classification;
        List<string> tags = [];
        string? doctorName = null;
        List<string> conditionNames = [];

        try
        {
            var classResult = await ClassifyAndTagAsync(extractedText);
            if (IsRateLimited) { _queue.Writer.TryWrite(documentId); return; }
            if (classResult != null)
            {
                classification = classResult.Classification ?? classification;
                tags = classResult.Tags ?? [];
                doctorName = classResult.DoctorName;
                conditionNames = classResult.ConditionNames ?? [];
                aiResponses["classification"] = classResult;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Classification failed for document {DocumentId}", documentId);
        }

        // Step 3: Associate doctor to document (ALL types)
        long? doctorId = null;
        if (!string.IsNullOrWhiteSpace(doctorName))
        {
            try
            {
                var doctor = await medicalDocsService.FindOrCreateDoctorByNameAsync(doctorName.Trim());
                doctorId = doctor?.Id;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Doctor association failed for document {DocumentId}", documentId);
            }
        }

        // Step 3b: Associate conditions to document (ALL types)
        if (conditionNames.Count > 0)
        {
            try
            {
                await medicalDocsService.AssignConditionsFromAiAsync(
                    documentId, doc.PersonId, conditionNames, this);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Condition association failed for document {DocumentId}", documentId);
            }
        }

        // Step 4: Branch on classification for targeted extraction
        var effectiveClassification = classification ?? "other";
        BillingExtractionResult? billingData = null;
        PrescriptionExtractionResult? prescriptionData = null;

        if (effectiveClassification is "receipt" or "insurance")
        {
            try
            {
                billingData = await ExtractBillingDataAsync(extractedText, effectiveClassification);
                if (IsRateLimited) { _queue.Writer.TryWrite(documentId); return; }
                if (billingData != null)
                    aiResponses["billing"] = billingData;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Billing extraction failed for document {DocumentId}", documentId);
            }
        }
        else if (effectiveClassification == "prescription")
        {
            try
            {
                prescriptionData = await ExtractPrescriptionDataAsync(extractedText);
                if (IsRateLimited) { _queue.Writer.TryWrite(documentId); return; }
                if (prescriptionData != null)
                    aiResponses["prescription"] = prescriptionData;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Prescription extraction failed for document {DocumentId}", documentId);
            }
        }

        // Step 5: Sanitize billing data
        if (billingData != null)
            SanitizeExtractedBills(billingData);

        // Step 6: Persist results
        var rawResponse = JsonSerializer.Serialize(aiResponses, JsonOpts);

        await medicalDocsService.UpdateAiResultsAsync(documentId, extractedText, classification, rawResponse, doctorId);

        if (tags.Count > 0)
            await medicalDocsService.AddTagsAsync(documentId, tags);

        // Clean up prior AI bills for this document (handles re-processing)
        await medicalDocsService.CleanupAiBillsForDocumentAsync(documentId);

        // Handle prescription documents
        if (prescriptionData?.PrescriptionInfo is { MedicationName: not null } rxInfo)
        {
            try
            {
                await medicalDocsService.AddPrescriptionFromAiAsync(
                    documentId, doc.PersonId, rxInfo, doctorName, this);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "AI prescription processing failed for document {DocumentId}", documentId);
            }
        }

        // Bill processing (billing documents only)
        if (billingData?.Bills is { Count: > 0 })
            await medicalDocsService.AddBillsFromAiAsync(documentId, doc.PersonId, billingData.Bills, billingData.Payments, this);

        _logger.LogInformation("AI processing complete for document {DocumentId}: classification={Classification}, tags={TagCount}, bills={BillCount}",
            documentId, classification, tags.Count, billingData?.Bills?.Count ?? 0);
    }

    private bool IsRateLimited => _rateLimitResetTime.HasValue && _rateLimitResetTime.Value > DateTime.UtcNow;

    private async Task<string?> ExtractTextAsync(byte[] fileData, string mimeType, string? fileName)
    {
        _logger.LogInformation("Extracting text via CLI, mimeType={MimeType}, size={Size}KB", mimeType, fileData.Length / 1024);

        var isImage = mimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        var isPdf = mimeType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase);

        if (!isImage && !isPdf)
        {
            _logger.LogInformation("Unsupported mime type {MimeType} for text extraction", mimeType);
            return null;
        }

        // Write decrypted file to temp path so the CLI can read it
        var ext = isPdf ? ".pdf" : Path.GetExtension(fileName ?? ".png");
        var tempPath = Path.Combine(Path.GetTempPath(), $"meddoc_{Guid.NewGuid()}{ext}");

        try
        {
            await File.WriteAllBytesAsync(tempPath, fileData);

            var systemPrompt = "Extract all text from this medical document. Include all visible text, numbers, dates, names, and amounts. Preserve the structure and formatting as much as possible. If the document is handwritten, do your best to transcribe it. Return only the extracted text, no commentary.";
            var userPrompt = $"Please read and extract all text from the file at: {tempPath}";

            return await CallClaudeCliAsync(systemPrompt, userPrompt, HaikuModel, allowReadTool: true);
        }
        finally
        {
            try { File.Delete(tempPath); } catch { /* cleanup best-effort */ }
        }
    }

    private async Task<ClassificationResult?> ClassifyAndTagAsync(string text)
    {
        _logger.LogInformation("Classifying and tagging via Haiku CLI");

        var truncatedText = text.Length > 4000 ? text[..4000] : text;

        var systemPrompt = @"You are a medical document classifier. Analyze the document text and return a JSON object with:
- ""classification"": one of: receipt, lab_result, prescription, imaging, dr_note, insurance, referral, discharge, recording, other
- ""tags"": array of relevant tag strings (lowercase, e.g. ""blood work"", ""cardiology"", ""annual physical"", ""copay"")
- ""doctorName"": string or null — the individual doctor/physician name mentioned (e.g. ""Dr. John Smith"" → ""John Smith""). If multiple, pick the primary/treating physician.
- ""conditionNames"": array of medical condition names mentioned or clearly implied (e.g. ""Type 2 Diabetes"", ""Hypertension""). Only include conditions you can confidently identify. Use standard medical terminology. Return empty array if none are obvious.

Return ONLY the JSON object, no other text.";

        var userPrompt = $"Analyze this medical document text and classify it.\n\nDocument text:\n{truncatedText}";

        var response = await CallClaudeCliAsync(systemPrompt, userPrompt, HaikuModel);

        if (response == null) return null;

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

    private async Task<BillingExtractionResult?> ExtractBillingDataAsync(string text, string classification)
    {
        _logger.LogInformation("Extracting billing data via Sonnet CLI, classification={Classification}", classification);

        var truncatedText = text.Length > 6000 ? text[..6000] : text;

        var systemPrompt = @"You are a medical billing data extractor. Extract financial data from this document.

Return a JSON object with:
- ""bills"": array of bill/charge objects, each with: ""totalAmount"" (number, the GROSS total of all positive charges before any payments or credits), ""category"" (string: office_visit, lab, pharmacy, imaging, therapy, hospital, specialist, other), ""billDate"" (string, YYYY-MM-DD or null), ""summary"" (string, brief description of the charge), ""providerName"" (string or null — the billing provider/facility name, e.g. ""Intermountain Healthcare"", ""Walgreens"". This is the entity sending the bill, NOT the individual doctor), ""lineItems"" (array of {""description"": string, ""amount"": number} or null — only POSITIVE charge items)
- ""payments"": array of payment objects, each with: ""amount"" (number, always positive), ""paymentType"" (string: patient_payment, insurance_payment, insurance_adjustment, write_off), ""paymentDate"" (string, YYYY-MM-DD or null), ""description"" (string), ""billIndex"" (number or null, 0-based index into the bills array that this payment applies to)

CRITICAL — line items vs payments:
- Line items are ONLY positive charges that break down what was billed (e.g., ""Vitrectomy: $5,731"", ""Supplies: $7,500"").
- Negative amounts, credits, refunds, or items labeled ""payment"" are PAYMENTS, not line items. Extract them in the ""payments"" array with a positive amount.
  Example: a line showing ""Payment: -$25.00"" → extract as a patient_payment of $25 (NOT as a line item of -$25).
- totalAmount should be the sum of POSITIVE charges only (before credits/payments are subtracted). Do not subtract payments from totalAmount.

Guidelines for document types:
- EOBs (Explanation of Benefits): create the bill (total charge) plus insurance_payment and/or insurance_adjustment for what insurance covered, and patient_payment for patient responsibility
- Receipts: create the bill (total charge) plus a patient_payment for the amount paid
- Invoices/statements/estimates: create the bill (total positive charges). If any payment or credit lines appear, extract those as payments.
- Each unique charge should be one bill. Do NOT create separate bills for line items that are part of the same visit/service — sum them into one bill.
- If the document lists individual charges (e.g., line items on a statement like ""exam: $150"", ""blood draw: $30""), include them in the ""lineItems"" array for that bill. The sum of line items should approximate totalAmount.

Only include fields you can confidently extract. If no bills are found, return empty arrays. Return ONLY the JSON object, no other text.";

        var userPrompt = $"Classification: {classification}\n\nDocument text:\n{truncatedText}";

        var response = await CallClaudeCliAsync(systemPrompt, userPrompt, SonnetModel);

        if (response == null) return null;

        var json = ExtractJson(response);

        try
        {
            return JsonSerializer.Deserialize<BillingExtractionResult>(json, JsonOpts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse billing extraction response: {Response}", response);
            return null;
        }
    }

    private async Task<PrescriptionExtractionResult?> ExtractPrescriptionDataAsync(string text)
    {
        _logger.LogInformation("Extracting prescription data via Sonnet CLI");

        var truncatedText = text.Length > 6000 ? text[..6000] : text;

        var systemPrompt = @"You are a medical prescription data extractor. Extract prescription details from this document.

Return a JSON object with:
- ""prescriptionInfo"": object with ""medicationName"" (string), ""dosage"" (string or null), ""frequency"" (string or null), ""rxNumber"" (the Rx/prescription number, string or null), ""pharmacy"" (pharmacy name e.g. ""Walgreens"", string or null), ""copay"" (number or null, amount paid), ""pickupDate"" (YYYY-MM-DD or null), ""personName"" (patient name, string or null), ""doctorName"" (prescribing doctor name, string or null)

Only include fields you can confidently extract. Return ONLY the JSON object, no other text.";

        var userPrompt = $"Document text:\n{truncatedText}";

        var response = await CallClaudeCliAsync(systemPrompt, userPrompt, SonnetModel);

        if (response == null) return null;

        var json = ExtractJson(response);

        try
        {
            return JsonSerializer.Deserialize<PrescriptionExtractionResult>(json, JsonOpts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse prescription extraction response: {Response}", response);
            return null;
        }
    }

    private async Task<string?> CallClaudeCliAsync(string systemPrompt, string userPrompt, string? model = null, bool allowReadTool = false)
    {
        var combinedPrompt = $"{systemPrompt}\n\n{userPrompt}";

        var args = new StringBuilder("-p --output-format text");
        if (!string.IsNullOrEmpty(model))
            args.Append($" --model {model}");
        if (allowReadTool)
            args.Append(" --allowedTools Read");

        var psi = new ProcessStartInfo
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (OperatingSystem.IsWindows())
        {
            psi.FileName = "cmd.exe";
            psi.Arguments = $"/c claude {args}";
        }
        else
        {
            psi.FileName = "claude";
            psi.Arguments = args.ToString();
        }

        using var process = Process.Start(psi);
        if (process == null)
        {
            _logger.LogError("Failed to start claude CLI process");
            return null;
        }

        // Write prompt to stdin, then close to signal EOF
        await process.StandardInput.WriteAsync(combinedPrompt);
        process.StandardInput.Close();

        // Read stdout/stderr concurrently to avoid deadlocks
        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill();
            _logger.LogError("claude CLI timed out after 120 seconds");
            return null;
        }

        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (!string.IsNullOrEmpty(stderr))
        {
            var resetTime = ParseRateLimitReset(stderr);
            if (resetTime.HasValue)
            {
                _rateLimitResetTime = resetTime.Value;
                _logger.LogWarning("Rate limit detected, reset at {ResetTime}", resetTime.Value);
                return null;
            }

            // Log non-rate-limit stderr as debug info
            _logger.LogDebug("claude CLI stderr: {Stderr}", stderr);
        }

        if (process.ExitCode != 0)
        {
            // Check stdout too for rate limit messages (some CLIs write there)
            var resetFromStdout = ParseRateLimitReset(stdout);
            if (resetFromStdout.HasValue)
            {
                _rateLimitResetTime = resetFromStdout.Value;
                _logger.LogWarning("Rate limit detected in stdout, reset at {ResetTime}", resetFromStdout.Value);
                return null;
            }

            _logger.LogError("claude CLI exited with code {ExitCode}.\nStderr: {Stderr}\nStdout: {Stdout}", process.ExitCode, stderr, stdout);
            return null;
        }

        return string.IsNullOrWhiteSpace(stdout) ? null : stdout.Trim();
    }

    private DateTime? ParseRateLimitReset(string output)
    {
        if (string.IsNullOrEmpty(output)) return null;

        // Try ISO timestamp pattern (e.g., 2026-02-09T14:30:00)
        var isoMatch = Regex.Match(output, @"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})");
        if (isoMatch.Success && DateTime.TryParse(isoMatch.Groups[1].Value, out var isoTime))
        {
            return isoTime.ToUniversalTime();
        }

        // Try time pattern (e.g., "reset at 2:30 PM", "try again at 14:30")
        var timeMatch = Regex.Match(output, @"(?:reset|try again|available)(?:\s+at)?\s+(\d{1,2}:\d{2}\s*(?:[APap][Mm])?)", RegexOptions.IgnoreCase);
        if (timeMatch.Success && DateTime.TryParse(timeMatch.Groups[1].Value, out var parsedTime))
        {
            // Assume today; if the time has passed, assume tomorrow
            var today = DateTime.Today.Add(parsedTime.TimeOfDay);
            if (today < DateTime.Now)
                today = today.AddDays(1);
            return today.ToUniversalTime();
        }

        // Try "in X minutes" pattern
        var minutesMatch = Regex.Match(output, @"(?:in|after)\s+(\d+)\s+minute", RegexOptions.IgnoreCase);
        if (minutesMatch.Success && int.TryParse(minutesMatch.Groups[1].Value, out var minutes))
        {
            return DateTime.UtcNow.AddMinutes(minutes);
        }

        // Fallback: detect rate limit keywords without a parseable time → wait 15 minutes
        if (Regex.IsMatch(output, @"rate.?limit|session.?limit|too many requests|usage limit", RegexOptions.IgnoreCase))
        {
            return DateTime.UtcNow.AddMinutes(15);
        }

        return null;
    }

    private static string ExtractJson(string response)
    {
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

    internal static void SanitizeExtractedBills(BillingExtractionResult result)
    {
        if (result.Bills == null) return;
        result.Payments ??= [];

        var paymentKeywords = new[] { "payment", "credit", "refund", "adjustment", "write-off", "write off", "discount", "applied" };
        var insuranceKeywords = new[] { "insurance", "ins ", "ins.", "aetna", "cigna", "united", "blue cross", "bcbs", "humana", "anthem", "medicare", "medicaid" };

        foreach (var bill in result.Bills)
        {
            if (bill.LineItems == null) continue;

            var toRemove = new List<LineItemExtraction>();

            foreach (var item in bill.LineItems)
            {
                var desc = item.Description?.ToLowerInvariant() ?? "";
                var isNegative = item.Amount < 0;
                var hasPaymentKeyword = paymentKeywords.Any(k => desc.Contains(k));

                if (!isNegative && !hasPaymentKeyword) continue;

                var isInsurance = insuranceKeywords.Any(k => desc.Contains(k));
                var paymentType = isInsurance ? "insurance_payment" : "patient_payment";
                if (desc.Contains("adjustment") || desc.Contains("write-off") || desc.Contains("write off"))
                    paymentType = isInsurance ? "insurance_adjustment" : "write_off";

                var billIndex = result.Bills.IndexOf(bill);
                result.Payments.Add(new PaymentExtraction
                {
                    Amount = Math.Abs(item.Amount),
                    PaymentType = paymentType,
                    Description = item.Description,
                    BillIndex = billIndex >= 0 ? billIndex : null
                });

                toRemove.Add(item);
            }

            foreach (var item in toRemove)
                bill.LineItems.Remove(item);
        }
    }

    public async Task<bool> DisambiguateBillMatchAsync(List<Models.MedicalBillCharge> existingCharges, List<LineItemExtraction> newItems, string? newSummary)
    {
        try
        {
            var existingLines = string.Join("\n", existingCharges.Select(c => $"  - {c.Description}: ${c.Amount:F2}"));
            var newLines = string.Join("\n", newItems.Select(i => $"  - {i.Description}: ${i.Amount:F2}"));

            var systemPrompt = @"You are comparing two sets of medical bill charges to determine if they represent the same bill. Return ONLY a JSON object with:
- ""sameBill"": true or false
- ""confidence"": ""high"", ""medium"", or ""low""

Consider: charges from the same bill may have slightly different descriptions or amounts across statements. Monthly statements of the same recurring service are the same bill.";

            var userPrompt = $"Existing bill charges:\n{existingLines}\n\nNew document charges:\n{newLines}";
            if (!string.IsNullOrEmpty(newSummary))
                userPrompt += $"\n\nNew document summary: {newSummary}";

            var response = await CallClaudeCliAsync(systemPrompt, userPrompt, HaikuModel);
            if (response == null) return false;

            var json = ExtractJson(response);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var sameBill = root.TryGetProperty("sameBill", out var sb) && sb.GetBoolean();
            var confidence = root.TryGetProperty("confidence", out var conf) ? conf.GetString() : "low";

            return sameBill && confidence != "low";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bill disambiguation failed, defaulting to no match");
            return false;
        }
    }

    public async Task<string?> FuzzyMatchProviderAsync(string extractedName, List<string> existingProviderNames)
    {
        try
        {
            var providerList = string.Join("\n", existingProviderNames.Select(n => $"  - {n}"));

            var systemPrompt = @"You are matching a billing provider name extracted from a medical document against a list of known providers. Return ONLY a JSON object with:
- ""matchedName"": the exact string from the existing list that matches, or null if no match
- ""confidence"": ""high"", ""medium"", or ""low""

Consider abbreviations, slight misspellings, and variations (e.g., ""Intermountain Health"" matches ""Intermountain Healthcare""). Only return a match with medium or high confidence.";

            var userPrompt = $"Extracted provider name: \"{extractedName}\"\n\nExisting providers:\n{providerList}";

            var response = await CallClaudeCliAsync(systemPrompt, userPrompt, HaikuModel);
            if (response == null) return null;

            var json = ExtractJson(response);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var matchedName = root.TryGetProperty("matchedName", out var mn) && mn.ValueKind == JsonValueKind.String ? mn.GetString() : null;
            var confidence = root.TryGetProperty("confidence", out var conf) ? conf.GetString() : "low";

            if (matchedName != null && confidence != "low")
                return matchedName;

            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Fuzzy provider matching failed for \"{ExtractedName}\"", extractedName);
            return null;
        }
    }

    public async Task<string?> FuzzyMatchConditionAsync(string extractedName, List<string> existingConditionNames)
    {
        try
        {
            var conditionList = string.Join("\n", existingConditionNames.Select(n => $"  - {n}"));

            var systemPrompt = @"You are matching a medical condition name extracted from a document against a list of known conditions for a patient. Return ONLY a JSON object with:
- ""matchedName"": the exact string from the existing list that matches, or null if no match
- ""confidence"": ""high"", ""medium"", or ""low""

Consider abbreviations, slight variations, and synonyms (e.g., ""Type 2 Diabetes"" matches ""Diabetes Mellitus Type 2"", ""HTN"" matches ""Hypertension""). Only return a match with medium or high confidence.";

            var userPrompt = $"Extracted condition name: \"{extractedName}\"\n\nExisting conditions:\n{conditionList}";

            var response = await CallClaudeCliAsync(systemPrompt, userPrompt, HaikuModel);
            if (response == null) return null;

            var json = ExtractJson(response);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var matchedName = root.TryGetProperty("matchedName", out var mn) && mn.ValueKind == JsonValueKind.String ? mn.GetString() : null;
            var confidence = root.TryGetProperty("confidence", out var conf) ? conf.GetString() : "low";

            if (matchedName != null && confidence != "low")
                return matchedName;

            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Fuzzy condition matching failed for \"{ExtractedName}\"", extractedName);
            return null;
        }
    }

    public async Task<string?> GenerateVisitPrepSummaryAsync(string doctorName, string? specialty, Models.VisitPrepData data)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Doctor: {doctorName}");
        if (!string.IsNullOrEmpty(specialty))
            sb.AppendLine($"Specialty: {specialty}");
        sb.AppendLine();

        if (data.ActiveConditions.Count > 0)
        {
            sb.AppendLine("Active Conditions:");
            foreach (var c in data.ActiveConditions)
                sb.AppendLine($"  - {c.Name}{(c.DiagnosedDate.HasValue ? $" (diagnosed {c.DiagnosedDate:yyyy-MM-dd})" : "")}");
            sb.AppendLine();
        }

        if (data.ActivePrescriptions.Count > 0)
        {
            sb.AppendLine("Current Medications:");
            foreach (var rx in data.ActivePrescriptions)
            {
                var details = new List<string>();
                if (!string.IsNullOrEmpty(rx.Dosage)) details.Add(rx.Dosage);
                if (!string.IsNullOrEmpty(rx.Frequency)) details.Add(rx.Frequency);
                sb.AppendLine($"  - {rx.MedicationName}{(details.Count > 0 ? $" ({string.Join(", ", details)})" : "")}");
            }
            sb.AppendLine();
        }

        if (data.RecentDocuments.Count > 0)
        {
            sb.AppendLine("Recent Documents with this Doctor:");
            foreach (var doc in data.RecentDocuments)
                sb.AppendLine($"  - {doc.Title ?? doc.FileName ?? "Untitled"}{(doc.DocumentDate.HasValue ? $" ({doc.DocumentDate:yyyy-MM-dd})" : "")}{(!string.IsNullOrEmpty(doc.Classification) ? $" [{doc.Classification}]" : "")}");
            sb.AppendLine();
        }

        if (data.RecentBills.Count > 0)
        {
            sb.AppendLine("Recent Bills with this Doctor (last 6 months):");
            foreach (var bill in data.RecentBills)
                sb.AppendLine($"  - ${bill.TotalAmount:F2}{(!string.IsNullOrEmpty(bill.Summary) ? $" - {bill.Summary}" : "")}{(bill.BillDate.HasValue ? $" ({bill.BillDate:yyyy-MM-dd})" : "")}");
            sb.AppendLine();
        }

        var systemPrompt = "You are a medical visit preparation assistant. Produce a concise narrative summary for a patient preparing to visit their doctor. Include: key conditions to discuss, current medications to review, recent visits, and any billing notes. Keep under 500 words.";
        var userPrompt = sb.ToString();

        return await CallClaudeCliAsync(systemPrompt, userPrompt, SonnetModel);
    }

    // --- Response DTOs ---

    public class ClassificationResult
    {
        public string? Classification { get; set; }
        public List<string>? Tags { get; set; }
        public string? DoctorName { get; set; }
        public List<string>? ConditionNames { get; set; }
    }

    public class BillingExtractionResult
    {
        public List<BillExtraction>? Bills { get; set; }
        public List<PaymentExtraction>? Payments { get; set; }
    }

    public class PrescriptionExtractionResult
    {
        public PrescriptionInfo? PrescriptionInfo { get; set; }
    }

    public class BillExtraction
    {
        public decimal TotalAmount { get; set; }
        public string? Category { get; set; }
        public string? BillDate { get; set; }
        public string? Summary { get; set; }
        public string? ProviderName { get; set; }
        public List<LineItemExtraction>? LineItems { get; set; }
    }

    public class LineItemExtraction
    {
        public string? Description { get; set; }
        public decimal Amount { get; set; }
    }

    public class PaymentExtraction
    {
        public decimal Amount { get; set; }
        public string? PaymentType { get; set; }
        public string? PaymentDate { get; set; }
        public string? Description { get; set; }
        public int? BillIndex { get; set; }
    }

    public class PrescriptionInfo
    {
        public string? MedicationName { get; set; }
        public string? Dosage { get; set; }
        public string? Frequency { get; set; }
        public string? RxNumber { get; set; }
        public string? Pharmacy { get; set; }
        public decimal? Copay { get; set; }
        public string? PickupDate { get; set; }
        public string? PersonName { get; set; }
        public string? DoctorName { get; set; }
    }
}
