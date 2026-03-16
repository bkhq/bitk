# Attachments

## GET /api/projects/:projectId/issues/:id/attachments/:attachmentId

Download an attachment file.

Returns raw file stream with `Content-Disposition: attachment` header.

Path is validated to stay within the upload directory (SEC-025).
