# Medical Documentation System — Roadmap

A dedicated admin-only section for organizing medical documents (receipts, doctor notes, recorded conversations, lab results, etc.) for multiple family members. Uses Claude AI to auto-classify, tag, and extract structured data from uploaded documents. Completely separate from the existing media/gallery system.

---

## Phase 1: Database Foundation & Core Document Management ✅
Tables for people, documents, tags, doctors, conditions, prescriptions, costs. Basic CRUD service. Admin-gated Razor Page with file upload and plain-text note entry.

## Phase 2: People & Document Browsing ✅
UI for managing people (family members). Document list with filtering by person, type icons, download/preview.

## Phase 3: Claude AI Integration ✅
`MedicalAiService` using Claude API. On upload: OCR, text extraction, auto-classification, auto-tagging, structured data extraction. Manual transcript field for audio files.

## Phase 4: Doctors, Conditions & Prescription Tracking ✅
Doctor/condition management (global doctors, per-person conditions). Prescription tracking with doctor linkage, expandable pickup history, and "last pickup" display. Inline add/edit/delete for all entities.

## Phase 5: AI CLI Migration ✅
Replaced Claude HTTP API with `claude -p` CLI pipe mode. Sequential `Channel<long>` background queue replaces fire-and-forget `Task.Run`. Rate limit detection parses reset time from CLI output and pauses the queue. Temp file approach for image/PDF OCR via CLI with `--allowedTools Read`.

## Phase 6: Bills & Payments ✅
Replaced the flat `medical_document_costs` model (which double/triple-counted AI-extracted line items) with a proper billing system. Bills represent unique charges; payments track money applied toward them (patient payments, insurance payments, adjustments, write-offs). Summary card shows out-of-pocket vs total charged. Bills support linked documents, expandable payment lists, and filter by paid/unpaid status. Old costs API endpoints preserved for backward compatibility with AI processing.

## Phase 7: AI Bills Integration ✅
Updated AI extraction prompt to create bills + payments instead of flat costs. On re-process: deletes AI-sourced bills/payments for document, re-creates (prevents duplicates). Smart matching: if extracted charge matches existing bill for same person (same amount, category, date within 30 days), links document instead of creating new. Removed `AddCostsAsync`, all costs CRUD methods, costs API endpoints, and `MedicalDocumentCost` model. DB table retained per policy.

## Phase 8: Search & Filtering ⬅️ **Up Next**
Full-text search on extracted text. Filter by person, doctor, condition, tags, document type, date range. Combined filters.

## Phase 9: AI-Enhanced Insights
Medical timeline per person. Visit prep summaries. Batch re-analysis when AI improves.

## Phase 10: Polish & Hardening
Pagination/lazy-loading. Export (PDF summary, CSV costs). Mobile-responsive UI.

---

## Feature requests (I'm writing these down for me. I may ask you to do these in the future, so please design any changes with the fact in mind that they may need to acommodate these)

## Calendar
A calendar that's easy to navigate, and shows what documents are on each day. If I see the month of January, at the very least, I should see something on the calendar indicating which days in January a document is associated with.

## Custom Colors
An easy way to customize colors instead of just having a light mode/dark mode. I still want to have light mode/dark mode as defaults, but custom colors should be an option as well.
