# Local Workshop Manager

Have you ever launched the non-Steam version of a Steam game and realised the Workshop is suddenly out of reach? You can still grab those mods, but only by slogging through SteamCMD, installing mods one by one, and dumping them into an ever-growing folder you can’t organise or keep current. Many developers ship across multiple platforms, yet only Steam enjoys that streamlined mod experience. Local Workshop Manager bridges that gap, bringing Workshop-quality mod discovery, collections, and updates to every copy, without the manual work.

Local Workshop Manager is an Electron application that recreates the Steam Workshop experience for non-Steam games. It combines a React front end with a Node-powered backend to manage workshop downloads, organize profile-based collections, and keep your mod library in sync.

---

## ✨ Features

- **Home** – Snapshot of the active profile's game with quick links into browsing, collection management, and some info about the game.
- **Browse** –  Workshop-style catalog with search, filtering, and one-click installs powered by SteamCMD.
- **Mod View** – Rich description view with media, requirements, install/uninstall controls, and dependencies.
- **Collections** – Profile-scoped lists that support drag-and-drop ordering, inline renaming, mass install, and dependency-aware bulk actions.
- **Manage Page** – Central hub to create, import/export, duplicate, or delete collections.
- **Downloads Queue** – Real-time status of active SteamCMD jobs with toast notifications for success and failure.
- **Profiles & Settings** – Switch between game setups, configure SteamCMD/API credentials, and tweak install defaults.

---

## Screenshots 

---

## 📦 Installation

### Option 1: Use the Installer (recommended)

1. Download the latest `LocalWorkshopManager-Setup-x.y.z.exe` from the Releases page.
2. Verify the installer checksum (see `SHA256`/`SHA512` values published with the release).
3. Run the installer. The app will appear in the Start menu after installation.

### Option 2: Run from Source

1. Install prerequisites:
   - Node.js 18 or newer (includes npm 9+).
   - Git (optional, but recommended).
2. Clone and install:
   ```bash
   git clone https://github.com/YourOrg/LocalWorkshopManager.git
   cd LocalWorkshopManager
   npm install
   ```
3. Launch in development mode:
   ```bash
   npm run dev
   ```
   This starts Vite (renderer) and Electron (main process) with hot reload.
4. Build production bundles:
   ```bash
   npm run build        
   npm run start        
   npm run package      
   ```

---

## 🚀 App Setup (Required)

### 1. Install SteamCMD

1. Download SteamCMD for your platform: <https://developer.valvesoftware.com/wiki/SteamCMD>
2. Extract it to a permanent folder, or the same folder as the app. 
3. Run SteamCMD at least once so it can update and generate required support files.
4. Configure the path inside Local Workshop Manager (Settings → SteamCMD Path) or by editing `data/config.json`:
   ```json
   {
     "steamCmdPath": "C:\\Tools\\SteamCMD\\steamcmd.exe"
   }
   ```

### 2. Generate a Steam Web API Key

1. Visit <https://steamcommunity.com/dev/apikey>.
2. Sign in with a Steam account.
3. Enter a domain (any word or string is fine, you do not need a domain.) and press “Register”.
4. Copy the generated key and add it to Local Workshop Manager:
   - via Settings → Steam API Key, or
   - by editing `data/config.json`:
     ```json
     {
       "steamApiKey": "YOUR_STEAM_API_KEY"
     }
     ```

### 5. Click save and start browsing.

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues with feature requests or bug reports, and submit pull requests for improvements. 

---

## 📄 License

MIT © Local Workshop Manager contributors. See `LICENSE` for details.