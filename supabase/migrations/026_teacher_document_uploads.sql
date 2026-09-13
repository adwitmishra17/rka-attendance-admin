-- ============================================================================
-- 026_teacher_document_uploads
--
-- Teachers can now self-upload their onboarding documents from the Teacher PWA
-- into the existing employee_documents store. Tag each row with the specific
-- slot it fills so the PWA onboarding can show which required documents are
-- still missing, and so HRMS can group them.
--
-- Slots: class_10, class_12, graduation, post_graduation, bed, aadhaar, pan.
-- Nullable — legacy/admin-uploaded rows (categorised only by `category`) stay
-- NULL and are unaffected.
-- ============================================================================

alter table public.employee_documents
  add column if not exists doc_type text;

comment on column public.employee_documents.doc_type is
  'Specific document slot for teacher self-uploads: class_10, class_12, graduation, post_graduation, bed, aadhaar, pan. NULL for legacy/admin uploads.';

-- Optional: mark how a row arrived, so HRMS can distinguish teacher self-service
-- uploads from admin uploads. Defaults to admin for existing rows.
alter table public.employee_documents
  add column if not exists uploaded_via text not null default 'admin';

comment on column public.employee_documents.uploaded_via is
  'admin = uploaded by office in HRMS; teacher = self-uploaded from the Teacher PWA.';
