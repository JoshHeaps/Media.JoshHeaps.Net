using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/medical-docs")]
public class MedicalDocsApi(DbExecutor dbExecutor, MedicalDocsService medicalDocsService, MedicalAiService medicalAiService) : ControllerBase
{
    // --- People ---

    [HttpGet("people")]
    public async Task<IActionResult> GetPeople()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var people = await medicalDocsService.GetPeopleAsync();
        return Ok(people);
    }

    [HttpPost("people")]
    public async Task<IActionResult> CreatePerson([FromBody] CreatePersonRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var person = await medicalDocsService.CreatePersonAsync(request.Name.Trim(), request.DateOfBirth, request.Notes);
        if (person == null)
            return StatusCode(500, new { error = "Failed to create person" });

        return Ok(person);
    }

    // --- Documents ---

    [HttpGet("documents")]
    public async Task<IActionResult> GetDocuments([FromQuery] long? personId, [FromQuery] int offset = 0, [FromQuery] int limit = 50)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (limit < 1 || limit > 100) limit = 50;
        if (offset < 0) offset = 0;

        var documents = await medicalDocsService.GetDocumentsAsync(personId, offset, limit);
        return Ok(documents);
    }

    [HttpPost("documents/upload")]
    [RequestSizeLimit(52_428_800)] // 50MB
    public async Task<IActionResult> UploadDocument([FromForm] long personId, [FromForm] string? title, [FromForm] string? description, [FromForm] DateTime? documentDate, [FromForm] string? classification, IFormFile file)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var doc = await medicalDocsService.SaveDocumentAsync(personId, file, title, description, documentDate, classification);
        if (doc == null)
            return StatusCode(500, new { error = "Failed to save document" });

        medicalAiService.EnqueueProcessing(doc.Id);

        return Ok(doc);
    }

    [HttpPost("documents/note")]
    public async Task<IActionResult> CreateNote([FromBody] CreateNoteRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.PersonId <= 0)
            return BadRequest(new { error = "Person is required" });
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "Title is required" });

        var doc = await medicalDocsService.SaveNoteAsync(request.PersonId, request.Title.Trim(), request.Description ?? "", request.DocumentDate, request.Classification);
        if (doc == null)
            return StatusCode(500, new { error = "Failed to create note" });

        medicalAiService.EnqueueProcessing(doc.Id);

        return Ok(doc);
    }

    [HttpGet("documents/{id}")]
    public async Task<IActionResult> GetDocument(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var doc = await medicalDocsService.GetDocumentByIdAsync(id);
        if (doc == null) return NotFound(new { error = "Document not found" });

        return Ok(doc);
    }

    [HttpGet("documents/{id}/download")]
    public async Task<IActionResult> DownloadDocument(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var doc = await medicalDocsService.GetDocumentByIdAsync(id);
        if (doc == null) return NotFound(new { error = "Document not found" });

        if (doc.DocumentType != "file")
            return BadRequest(new { error = "Cannot download a note" });

        var data = await medicalDocsService.GetDecryptedDocumentDataAsync(id);
        if (data == null) return NotFound(new { error = "File not found" });

        return File(data, doc.MimeType ?? "application/octet-stream", doc.FileName);
    }

    [HttpDelete("documents/{id}")]
    public async Task<IActionResult> DeleteDocument(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeleteDocumentAsync(id);
        if (!success) return NotFound(new { error = "Document not found" });

        return Ok(new { success = true });
    }

    // --- AI Processing ---

    [HttpPost("documents/{id}/process")]
    public async Task<IActionResult> ProcessDocument(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var doc = await medicalDocsService.GetDocumentByIdAsync(id);
        if (doc == null) return NotFound(new { error = "Document not found" });

        medicalAiService.EnqueueProcessing(id);

        return Ok(new { success = true, message = "AI processing started" });
    }

    [HttpPost("documents/process-all")]
    public async Task<IActionResult> ProcessAllDocuments()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var unprocessedIds = await medicalDocsService.GetUnprocessedDocumentIdsAsync();

        foreach (var docId in unprocessedIds)
        {
            medicalAiService.EnqueueProcessing(docId);
        }

        return Ok(new { success = true, queued = unprocessedIds.Count });
    }

    [HttpGet("documents/{id}/tags")]
    public async Task<IActionResult> GetDocumentTags(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var tags = await medicalDocsService.GetDocumentTagsAsync(id);
        return Ok(tags);
    }

    // --- Doctors ---

    [HttpGet("doctors")]
    public async Task<IActionResult> GetDoctors()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var doctors = await medicalDocsService.GetDoctorsAsync();
        return Ok(doctors);
    }

    [HttpPost("doctors")]
    public async Task<IActionResult> CreateDoctor([FromBody] CreateDoctorRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var doctor = await medicalDocsService.CreateDoctorAsync(request.Name.Trim(), request.Specialty, request.Phone, request.Address, request.Notes);
        if (doctor == null)
            return StatusCode(500, new { error = "Failed to create doctor" });

        return Ok(doctor);
    }

    [HttpPut("doctors/{id}")]
    public async Task<IActionResult> UpdateDoctor(long id, [FromBody] CreateDoctorRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var success = await medicalDocsService.UpdateDoctorAsync(id, request.Name.Trim(), request.Specialty, request.Phone, request.Address, request.Notes);
        if (!success) return NotFound(new { error = "Doctor not found" });

        return Ok(new { success = true });
    }

    [HttpDelete("doctors/{id}")]
    public async Task<IActionResult> DeleteDoctor(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeleteDoctorAsync(id);
        if (!success) return NotFound(new { error = "Doctor not found" });

        return Ok(new { success = true });
    }

    // --- Conditions ---

    [HttpGet("conditions")]
    public async Task<IActionResult> GetConditions([FromQuery] long personId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        var conditions = await medicalDocsService.GetConditionsAsync(personId);
        return Ok(conditions);
    }

    [HttpPost("conditions")]
    public async Task<IActionResult> CreateCondition([FromBody] CreateConditionRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.PersonId <= 0)
            return BadRequest(new { error = "Person is required" });
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var condition = await medicalDocsService.CreateConditionAsync(request.PersonId, request.Name.Trim(), request.DiagnosedDate, request.Notes);
        if (condition == null)
            return StatusCode(500, new { error = "Failed to create condition" });

        return Ok(condition);
    }

    [HttpPut("conditions/{id}")]
    public async Task<IActionResult> UpdateCondition(long id, [FromBody] UpdateConditionRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var success = await medicalDocsService.UpdateConditionAsync(id, request.Name.Trim(), request.DiagnosedDate, request.Notes, request.IsActive);
        if (!success) return NotFound(new { error = "Condition not found" });

        return Ok(new { success = true });
    }

    [HttpDelete("conditions/{id}")]
    public async Task<IActionResult> DeleteCondition(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeleteConditionAsync(id);
        if (!success) return NotFound(new { error = "Condition not found" });

        return Ok(new { success = true });
    }

    // --- Prescriptions ---

    [HttpGet("prescriptions")]
    public async Task<IActionResult> GetPrescriptions([FromQuery] long personId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        var prescriptions = await medicalDocsService.GetPrescriptionsAsync(personId);
        return Ok(prescriptions);
    }

    [HttpPost("prescriptions")]
    public async Task<IActionResult> CreatePrescription([FromBody] CreatePrescriptionRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.PersonId <= 0)
            return BadRequest(new { error = "Person is required" });
        if (string.IsNullOrWhiteSpace(request.MedicationName))
            return BadRequest(new { error = "Medication name is required" });

        var prescription = await medicalDocsService.CreatePrescriptionAsync(request.PersonId, request.MedicationName.Trim(), request.Dosage, request.Frequency, request.DoctorId, request.StartDate, request.Notes);
        if (prescription == null)
            return StatusCode(500, new { error = "Failed to create prescription" });

        return Ok(prescription);
    }

    [HttpPut("prescriptions/{id}")]
    public async Task<IActionResult> UpdatePrescription(long id, [FromBody] UpdatePrescriptionRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.MedicationName))
            return BadRequest(new { error = "Medication name is required" });

        var success = await medicalDocsService.UpdatePrescriptionAsync(id, request.MedicationName.Trim(), request.Dosage, request.Frequency, request.DoctorId, request.StartDate, request.EndDate, request.Notes, request.IsActive);
        if (!success) return NotFound(new { error = "Prescription not found" });

        return Ok(new { success = true });
    }

    [HttpDelete("prescriptions/{id}")]
    public async Task<IActionResult> DeletePrescription(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeletePrescriptionAsync(id);
        if (!success) return NotFound(new { error = "Prescription not found" });

        return Ok(new { success = true });
    }

    // --- Pickups ---

    [HttpGet("prescriptions/{id}/pickups")]
    public async Task<IActionResult> GetPickups(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var pickups = await medicalDocsService.GetPickupsAsync(id);
        return Ok(pickups);
    }

    [HttpPost("prescriptions/{id}/pickups")]
    public async Task<IActionResult> CreatePickup(long id, [FromBody] CreatePickupRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var pickup = await medicalDocsService.CreatePickupAsync(id, request.PickupDate, request.Quantity, request.Pharmacy, request.Cost, request.Notes);
        if (pickup == null)
            return StatusCode(500, new { error = "Failed to create pickup" });

        return Ok(pickup);
    }

    [HttpDelete("pickups/{id}")]
    public async Task<IActionResult> DeletePickup(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeletePickupAsync(id);
        if (!success) return NotFound(new { error = "Pickup not found" });

        return Ok(new { success = true });
    }

    // --- Auth helpers (same pattern as AdminApi) ---

    private async Task<bool> HasMedicalAccess(long userId)
    {
        return await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.user_roles ur JOIN app.roles r ON ur.role_id = r.id WHERE ur.user_id = @UserId AND r.name = 'medical')",
            new { UserId = userId });
    }

    private long? GetUserIdFromAuth()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && long.TryParse(userIdClaim, out var jwtUserId))
        {
            return jwtUserId;
        }

        var userIdString = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userIdString) && long.TryParse(userIdString, out var sessionUserId))
        {
            return sessionUserId;
        }

        return null;
    }
}

public record CreatePersonRequest(string Name, DateTime? DateOfBirth = null, string? Notes = null);
public record CreateNoteRequest(long PersonId, string Title, string? Description = null, DateTime? DocumentDate = null, string? Classification = null);
public record CreateDoctorRequest(string Name, string? Specialty = null, string? Phone = null, string? Address = null, string? Notes = null);
public record CreateConditionRequest(long PersonId, string Name, DateTime? DiagnosedDate = null, string? Notes = null);
public record UpdateConditionRequest(string Name, DateTime? DiagnosedDate = null, string? Notes = null, bool IsActive = true);
public record CreatePrescriptionRequest(long PersonId, string MedicationName, string? Dosage = null, string? Frequency = null, long? DoctorId = null, DateTime? StartDate = null, string? Notes = null);
public record UpdatePrescriptionRequest(string MedicationName, string? Dosage = null, string? Frequency = null, long? DoctorId = null, DateTime? StartDate = null, DateTime? EndDate = null, string? Notes = null, bool IsActive = true);
public record CreatePickupRequest(DateTime PickupDate, string? Quantity = null, string? Pharmacy = null, decimal? Cost = null, string? Notes = null);
