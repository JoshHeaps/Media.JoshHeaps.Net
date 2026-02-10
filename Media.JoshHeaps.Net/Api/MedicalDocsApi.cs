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

    [HttpGet("documents/search")]
    public async Task<IActionResult> SearchDocuments(
        [FromQuery] long personId,
        [FromQuery] string? search = null,
        [FromQuery] string? classification = null,
        [FromQuery] string? documentType = null,
        [FromQuery] long? doctorId = null,
        [FromQuery] long? tagId = null,
        [FromQuery] long? conditionId = null,
        [FromQuery] DateTime? fromDate = null,
        [FromQuery] DateTime? toDate = null,
        [FromQuery] bool? aiProcessed = null,
        [FromQuery] int offset = 0,
        [FromQuery] int limit = 50)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        if (limit < 1 || limit > 100) limit = 50;
        if (offset < 0) offset = 0;

        var documents = await medicalDocsService.SearchDocumentsAsync(personId, search, classification, documentType, doctorId, tagId, conditionId, fromDate, toDate, aiProcessed, offset, limit);
        return Ok(documents);
    }

    [HttpGet("tags")]
    public async Task<IActionResult> GetPersonTags([FromQuery] long personId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        var tags = await medicalDocsService.GetPersonTagsAsync(personId);
        return Ok(tags);
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

    [HttpPut("documents/{id}")]
    public async Task<IActionResult> UpdateDocument(long id, [FromBody] UpdateDocumentRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.UpdateDocumentAsync(id, request.Title, request.Description, request.DocumentDate, request.Classification, request.DoctorId);
        if (!success) return NotFound(new { error = "Document not found" });

        return Ok(new { success = true });
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

    [HttpPost("documents/process-batch")]
    public async Task<IActionResult> ProcessBatch([FromBody] ProcessBatchRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.DocumentIds == null || request.DocumentIds.Count == 0)
            return BadRequest(new { error = "No document IDs provided" });

        var queued = 0;
        foreach (var docId in request.DocumentIds)
        {
            var doc = await medicalDocsService.GetDocumentByIdAsync(docId);
            if (doc != null)
            {
                medicalAiService.EnqueueProcessing(docId);
                queued++;
            }
        }

        return Ok(new { queued });
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

        var prescription = await medicalDocsService.CreatePrescriptionAsync(request.PersonId, request.MedicationName.Trim(), request.Dosage, request.Frequency, request.DoctorId, request.StartDate, request.Notes, request.RxNumber?.Trim());
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

        var success = await medicalDocsService.UpdatePrescriptionAsync(id, request.MedicationName.Trim(), request.Dosage, request.Frequency, request.DoctorId, request.StartDate, request.EndDate, request.Notes, request.IsActive, request.RxNumber?.Trim());
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

    // --- Billing Providers ---

    [HttpGet("providers")]
    public async Task<IActionResult> GetProviders([FromQuery] long personId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        var providers = await medicalDocsService.GetProvidersAsync(personId);
        return Ok(providers);
    }

    [HttpPost("providers")]
    public async Task<IActionResult> CreateProvider([FromBody] CreateProviderRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.PersonId <= 0)
            return BadRequest(new { error = "Person is required" });
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var provider = await medicalDocsService.CreateProviderAsync(request.PersonId, request.Name.Trim(), request.Notes);
        if (provider == null)
            return StatusCode(500, new { error = "Failed to create provider" });

        return Ok(provider);
    }

    [HttpPut("providers/{id}")]
    public async Task<IActionResult> UpdateProvider(long id, [FromBody] UpdateProviderRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var success = await medicalDocsService.UpdateProviderAsync(id, request.Name.Trim(), request.Notes);
        if (!success) return NotFound(new { error = "Provider not found" });

        return Ok(new { success = true });
    }

    [HttpDelete("providers/{id}")]
    public async Task<IActionResult> DeleteProvider(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeleteProviderAsync(id);
        if (!success) return NotFound(new { error = "Provider not found" });

        return Ok(new { success = true });
    }

    // --- Provider Payments ---

    [HttpGet("providers/{id}/payments")]
    public async Task<IActionResult> GetProviderPayments(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var payments = await medicalDocsService.GetProviderPaymentsAsync(id);
        return Ok(payments);
    }

    [HttpPost("providers/{id}/payments")]
    public async Task<IActionResult> CreateProviderPayment(long id, [FromBody] CreateProviderPaymentRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.Amount <= 0)
            return BadRequest(new { error = "Amount must be greater than 0" });

        var payment = await medicalDocsService.CreateProviderPaymentAsync(id, request.Amount, request.PaymentDate, request.Description);
        if (payment == null)
            return StatusCode(500, new { error = "Failed to create payment" });

        return Ok(payment);
    }

    [HttpDelete("provider-payments/{id}")]
    public async Task<IActionResult> DeleteProviderPayment(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeleteProviderPaymentAsync(id);
        if (!success) return NotFound(new { error = "Payment not found" });

        return Ok(new { success = true });
    }

    // --- Bills ---

    [HttpGet("bills")]
    public async Task<IActionResult> GetBills([FromQuery] long personId, [FromQuery] long? providerId = null)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        var bills = await medicalDocsService.GetBillsAsync(personId, providerId);
        return Ok(bills);
    }

    [HttpPost("bills")]
    public async Task<IActionResult> CreateBill([FromBody] CreateBillRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.PersonId <= 0)
            return BadRequest(new { error = "Person is required" });
        if (request.TotalAmount <= 0)
            return BadRequest(new { error = "Amount must be greater than 0" });

        var bill = await medicalDocsService.CreateBillAsync(request.PersonId, request.TotalAmount, request.Summary, request.Category, request.BillDate, request.DoctorId, request.ProviderId);
        if (bill == null)
            return StatusCode(500, new { error = "Failed to create bill" });

        return Ok(bill);
    }

    [HttpPut("bills/{id}")]
    public async Task<IActionResult> UpdateBill(long id, [FromBody] UpdateBillRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.TotalAmount <= 0)
            return BadRequest(new { error = "Amount must be greater than 0" });

        var success = await medicalDocsService.UpdateBillAsync(id, request.TotalAmount, request.Summary, request.Category, request.BillDate, request.DoctorId, request.ProviderId);
        if (!success) return NotFound(new { error = "Bill not found" });

        return Ok(new { success = true });
    }

    [HttpDelete("bills/{id}")]
    public async Task<IActionResult> DeleteBill(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeleteBillAsync(id);
        if (!success) return NotFound(new { error = "Bill not found" });

        return Ok(new { success = true });
    }

    [HttpPost("bills/{id}/documents")]
    public async Task<IActionResult> LinkDocumentToBill(long id, [FromBody] LinkDocumentRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.DocumentId <= 0)
            return BadRequest(new { error = "Document is required" });

        var success = await medicalDocsService.LinkDocumentToBillAsync(id, request.DocumentId);
        if (!success)
            return StatusCode(500, new { error = "Failed to link document" });

        return Ok(new { success = true });
    }

    [HttpDelete("bills/{billId}/documents/{docId}")]
    public async Task<IActionResult> UnlinkDocumentFromBill(long billId, long docId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.UnlinkDocumentFromBillAsync(billId, docId);
        if (!success) return NotFound(new { error = "Link not found" });

        return Ok(new { success = true });
    }

    // --- Bill Charges ---

    [HttpGet("bills/{id}/charges")]
    public async Task<IActionResult> GetBillCharges(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var charges = await medicalDocsService.GetChargesAsync(id);
        return Ok(charges);
    }

    [HttpPost("bills/{id}/charges")]
    public async Task<IActionResult> CreateCharge(long id, [FromBody] CreateChargeRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Description))
            return BadRequest(new { error = "Description is required" });
        if (request.Amount <= 0)
            return BadRequest(new { error = "Amount must be greater than 0" });

        var charge = await medicalDocsService.CreateChargeAsync(id, request.Description.Trim(), request.Amount);
        if (charge == null)
            return StatusCode(500, new { error = "Failed to create charge" });

        return Ok(charge);
    }

    [HttpDelete("bill-charges/{id}")]
    public async Task<IActionResult> DeleteCharge(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        var success = await medicalDocsService.DeleteChargeAsync(id);
        if (!success) return NotFound(new { error = "Charge not found" });

        return Ok(new { success = true });
    }

    // --- Timeline ---

    [HttpGet("timeline")]
    public async Task<IActionResult> GetTimeline([FromQuery] long personId, [FromQuery] int offset = 0, [FromQuery] int limit = 100)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        if (limit < 1 || limit > 200) limit = 100;
        if (offset < 0) offset = 0;

        var events = await medicalDocsService.GetTimelineAsync(personId, offset, limit);
        return Ok(events);
    }

    // --- Visit Prep ---

    [HttpGet("visit-prep")]
    public async Task<IActionResult> GetVisitPrep([FromQuery] long personId, [FromQuery] long doctorId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0 || doctorId <= 0)
            return BadRequest(new { error = "personId and doctorId are required" });

        var data = await medicalDocsService.GetVisitPrepAsync(personId, doctorId);
        return Ok(data);
    }

    [HttpPost("visit-prep/summary")]
    public async Task<IActionResult> GenerateVisitPrepSummary([FromBody] VisitPrepSummaryRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (request.PersonId <= 0 || request.DoctorId <= 0)
            return BadRequest(new { error = "personId and doctorId are required" });

        var data = await medicalDocsService.GetVisitPrepAsync(request.PersonId, request.DoctorId);
        var doctor = await medicalDocsService.GetDoctorByIdAsync(request.DoctorId);
        if (doctor == null)
            return NotFound(new { error = "Doctor not found" });

        var summary = await medicalAiService.GenerateVisitPrepSummaryAsync(doctor.Name, doctor.Specialty, data);
        return Ok(new { summary });
    }

    [HttpGet("bills/summary")]
    public async Task<IActionResult> GetBillSummary([FromQuery] long personId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();
        if (!await HasMedicalAccess(userId.Value)) return Forbid();

        if (personId <= 0)
            return BadRequest(new { error = "personId is required" });

        var summary = await medicalDocsService.GetBillSummaryAsync(personId);
        return Ok(summary);
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
public record UpdateDocumentRequest(string? Title = null, string? Description = null, DateTime? DocumentDate = null, string? Classification = null, long? DoctorId = null);
public record CreateDoctorRequest(string Name, string? Specialty = null, string? Phone = null, string? Address = null, string? Notes = null);
public record CreateConditionRequest(long PersonId, string Name, DateTime? DiagnosedDate = null, string? Notes = null);
public record UpdateConditionRequest(string Name, DateTime? DiagnosedDate = null, string? Notes = null, bool IsActive = true);
public record CreatePrescriptionRequest(long PersonId, string MedicationName, string? Dosage = null, string? Frequency = null, long? DoctorId = null, DateTime? StartDate = null, string? Notes = null, string? RxNumber = null);
public record UpdatePrescriptionRequest(string MedicationName, string? Dosage = null, string? Frequency = null, long? DoctorId = null, DateTime? StartDate = null, DateTime? EndDate = null, string? Notes = null, bool IsActive = true, string? RxNumber = null);
public record CreatePickupRequest(DateTime PickupDate, string? Quantity = null, string? Pharmacy = null, decimal? Cost = null, string? Notes = null);
public record CreateProviderRequest(long PersonId, string Name, string? Notes = null);
public record UpdateProviderRequest(string Name, string? Notes = null);
public record CreateProviderPaymentRequest(decimal Amount, DateTime? PaymentDate = null, string? Description = null);
public record CreateBillRequest(long PersonId, decimal TotalAmount, string? Summary = null, string? Category = null, DateTime? BillDate = null, long? DoctorId = null, long? ProviderId = null);
public record UpdateBillRequest(decimal TotalAmount, string? Summary = null, string? Category = null, DateTime? BillDate = null, long? DoctorId = null, long? ProviderId = null);
public record LinkDocumentRequest(long DocumentId);
public record CreateChargeRequest(string Description, decimal Amount);
public record ProcessBatchRequest(List<long> DocumentIds);
public record VisitPrepSummaryRequest(long PersonId, long DoctorId);
