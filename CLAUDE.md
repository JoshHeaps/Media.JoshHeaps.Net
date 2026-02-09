# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack ASP.NET Core 8 media management application (Media.JoshHeaps.Net) with encrypted photo storage, folder organization with sharing, and knowledge graph visualization. PostgreSQL backend, Razor Pages frontend with vanilla JavaScript.

## Build & Run

```bash
# Restore and build
dotnet build Media.JoshHeaps.Net.sln

# Run the app (HTTPS: localhost:7007, HTTP: localhost:5029)
dotnet run --project Media.JoshHeaps.Net

# Run database migrations (requires psql on PATH)
./run-migrations.ps1 -ConnectionString "<connection_string>"
```

Sensitive config (DB connection string, JWT signing key, encryption key, email credentials) is stored in .NET User Secrets (ID: `1ee15d15-1d19-471d-8772-ce72aeaafbd3`). No test project exists.

## Architecture

### Backend Layers

- **Api/** — REST controllers. Routes: `/api/auth/`, `/api/media/`, `/api/folder/`, `/api/folder-share/`, `/api/graph/`
- **Services/** — Business logic (AuthService, MediaService, FolderService, GraphService, EmailService, EncryptionService, UserService). Registered via DI in Program.cs.
- **Models/** — Data models shared between API and Razor Pages
- **Pages/** — Razor Pages for server-rendered UI. Protected pages inherit from `AuthenticatedPageModel` (session-based auth).

### Authentication

Dual auth scheme: **session cookies** for Razor Pages, **JWT Bearer** for API endpoints. Session timeout is 2 hours; JWT expiry is 30 days. Account locks after 5 failed login attempts for 15 minutes.

### Database

PostgreSQL via `DbExecutor` singleton — a custom async query executor using raw Npgsql (no ORM). Parameterized queries use reflection on anonymous objects. Migration scripts in `Database/` are numbered 001–011 and must run in order (each script's dependencies come before it).

### File Storage

Media files are encrypted with AES-256-CBC before storage in `App_Data/media/{userId}/`. Each file gets a random IV. Files are decrypted on-demand when served. Max upload: 10MB, allowed types: JPEG, PNG, GIF, WEBP.

### Frontend

Razor Pages + vanilla JS + Bootstrap 5. Key JS files in `wwwroot/js/`:
- `gallery.js` / `folders.js` / `upload.js` / `drag-drop.js` — gallery and folder UI
- `folder-sharing.js` — sharing modal and permissions
- `network-graph.js` — D3-based graph visualization with community detection
- `context-menu.js` — right-click context menus
- `theme.js` — dark/light theme toggle

### Key Dependencies

Npgsql (PostgreSQL), BCrypt.Net-Next (password hashing), MailKit (email), SixLabors.ImageSharp (image processing), Microsoft.AspNetCore.Authentication.JwtBearer
