# Manga Tracker

A brutalist-styled web application for tracking manga chapters from MangaDex. Automatically checks for new chapters daily and keeps track of what you've read.

## Features

- **Search & Track**: Search MangaDex and add manga to your library
- **Automatic Updates**: Daily checks for new chapters at 6:00 AM
- **Read Tracking**: Mark chapters as read/unread with toggle functionality
- **Chapter Management**: Remove read chapters from your list while maintaining read history
- **Clean UI**: Neo-brutalist design with bold typography and high contrast

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla JavaScript, CSS
- **API**: MangaDex API
- **Process Manager**: PM2

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm

### Setup

1. Clone the repository:
```bash
git clone https://github.com/PhilippeHo27/MangaFetcher2.0.git
cd MangaFetcher2.0
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node server.js
```

The app will be available at `http://localhost:3000`

### Production Deployment (PM2)

```bash
pm2 start ecosystem.config.js --env production
pm2 save
```

## How It Works

### Database Structure

The app uses SQLite with three main tables:
- `users`: User accounts (single user by default)
- `tracked_manga`: Manga in your library
- `read_chapters`: Chapters you've marked as read

### Chapter Tracking Logic

- **Daily Checker**: Runs at 6:00 AM, fetches latest 20 chapters for each tracked manga
- **Duplicate Prevention**: Only adds chapters not already in your read history
- **Read Status**: Persists indefinitely to prevent re-adding old chapters
- **Toggle Functionality**: Click "READ" to mark/unmark chapters
- **Remove from List**: Click "X" to remove read chapters from view (keeps in history)

### First Run

On first run, the app will:
1. Create the `data/` directory automatically
2. Initialize a fresh SQLite database
3. Create all necessary tables
4. Be ready to track manga immediately

No manual database setup required!

## Usage

### Adding Manga
1. Search for a manga title in the search bar
2. Click "+ TRACK" to add it to your library

### Managing Chapters
- **Mark as Read**: Click "✓ READ" button (turns green)
- **Unmark**: Click "✓ READ" again to toggle back to unread
- **Remove from List**: Click "✕" button (only visible on read chapters)

### Manual Refresh
Click the refresh button (↻) in the top right to manually check for new chapters.

## API Endpoints

- `GET /api/search?title=<query>` - Search manga
- `GET /api/manga` - Get tracked manga with chapters
- `POST /api/track` - Track a new manga
- `DELETE /api/untrack/:mangaId` - Remove manga from library
- `POST /api/read` - Mark chapter as read
- `POST /api/unread` - Mark chapter as unread
- `POST /api/refresh` - Manually trigger chapter check (owner only)
- `GET /api/next-check` - Get next scheduled check time
- `POST /api/login` - Sign in (owner)
- `POST /api/logout` - Sign out
- `GET /api/me` - Current session info

## Authentication & Public Demo

The app has one owner account and a shared public demo.

- **Owner:** signed in via the top-right SIGN IN button. Initial credentials come from
  `ADMIN_USERNAME` / `ADMIN_PASSWORD`; there are no credential defaults. The login is
  remembered with an HttpOnly cookie for 30 days.
- **Public demo:** logged-out visitors share a demo library (`DEMO_USERNAME`,
  default `demo`) pre-populated with One Piece and Kagurabachi. Anyone can edit
  it, and the daily 6:00 AM job resets it back to the snapshot (each title shows
  its 3 newest chapters as unread).

### Auth environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | none | Owner login name, required only while initializing a database without an owner. |
| `ADMIN_PASSWORD` | none | Owner password of at least 12 characters, required only while initializing a database without an owner. |
| `DEMO_USERNAME` | `demo` | Username of the shared demo account. |
| `SESSION_SECRET` | none | Required high-entropy session secret of at least 32 characters. Changing it revokes all sessions. |
| `PUBLIC_ORIGIN` | none | Required browser origin, for example `https://philippeho.dev`; unsafe API requests from any other origin are rejected. |

To rotate the current owner password without placing it in shell history, pipe it on
standard input: `npm run reset-owner-password`. The command updates only owner row 1
and never prints the supplied password.

## Configuration

### Scheduler Settings

Edit `scheduler.js` to change the daily check time:
```javascript
// Default: 6:00 AM
schedule.scheduleJob('0 6 * * *', async () => {
  // ...
});
```

### Port Configuration

Edit `server.js` to change the port:
```javascript
app.listen(3000, () => {
  // ...
});
```

## File Structure

```
MangaFetcher2.0/
├── data/                    # SQLite database (auto-created, gitignored)
├── public/                  # Frontend files
│   ├── app.js              # Client-side JavaScript
│   ├── styles.css          # Brutalist styling
│   └── index.html          # Main HTML
├── .github/workflows/       # GitHub Actions for deployment
├── db.js                    # Database operations
├── mangadex.js             # MangaDex API wrapper
├── scheduler.js            # Daily chapter checker
├── server.js               # Express server
├── ecosystem.config.js     # PM2 configuration
└── package.json            # Dependencies

```

## Development

The database and read history are stored locally in the `data/` directory, which is gitignored. Each deployment will start with a fresh database.

## License

Private project

## Notes

- The app is designed for single-user use
- Chapter history persists to prevent duplicate notifications
- MangaDex API rate limits apply (be respectful!)
- The daily checker filters out chapters 1-3 (often returned by MangaDex regardless of actual latest chapters)
