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

## Phase 5: Financial Tracking ⬅️ **Up Next**
Receipt cost extraction and storage. Aggregation views by year, person, and category.

## Phase 6: Search & Filtering
Full-text search on extracted text. Filter by person, doctor, condition, tags, document type, date range. Combined filters.

## Phase 7: AI-Enhanced Insights
Medical timeline per person. Visit prep summaries. Batch re-analysis when AI improves.

## Phase 8: Polish & Hardening
Background AI processing queue. Pagination/lazy-loading. Export (PDF summary, CSV costs). Mobile-responsive UI.
