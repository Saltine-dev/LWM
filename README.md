# <p align="center"> LWM / Local Workshop Manager </p>

<img width="128" height="128" alt="Logo" src="https://github.com/user-attachments/assets/b1ac2b36-443a-4c77-8a74-4f83e64cf0bd" />

Have you ever launched the non-Steam version of a Steam game and realised the Workshop is suddenly out of reach? You can still grab those mods, but only by slogging through SteamCMD, installing mods one by one, and dumping them into an ever-growing folder you can’t organise or keep current. Many developers ship across multiple platforms, yet only Steam enjoys that streamlined mod experience. Local Workshop Manager bridges that gap, bringing Workshop-quality mod discovery, collections, and updates to every copy, without the manual work.


## ✨ Features

- **Home** – An Overview of the game's workshop page.
   - Quick tabs for Most Popular, Most Subscribed, and Most Recent mods. 
   - A carousel with up and coming mods this week. 
   - Mod tags to quickly sort by type. 
   - Some info and links for the chosen game. 

- **Browse** – Workshop-style catalog.
   - One-click installs powered by SteamCMD.
   - Filtering by type, timeframe, and tag. 
   - Improved keyword searching, with link and ID support. 
   - Page System

- **Mod View** – Rich mod description view. 
   - Thumbnail and screenshots with lighthouse view. 
   - Mod controls for easy install, uninstall, and manage page redirect. 
   - Mod Dependencies including other workshop items and DLC requirements.
   - Original mod description with markdown support. 
   - Mod comments with page system.
   - Breadcrumbs to follow your mod trail. 
   - General mod details and update log.

- **Collections** – Profile-scoped modlists. 
   - Bulk actions like install all, uninstall all, check all for updates. 
   - Dependency check during mod install for other workshop item or DLC requirements.
   - Import and export modlists made within LWM and share with your friends. 
   - Import existing modlists from Steam. 

- **Subscriptions** – Library of installed mods.
   - Toast notifications for job success, faliure, start/end, updates, etc. 
   - Download/update queue with status updates. 
   - Info and quick links for every installed item. 

- **Planned Features** - 
   - Packaged Mac/Linux App 
   - Improved collections page and management. 

---

## Screenshots 
<img width="2559" height="1389" alt="image" src="https://github.com/user-attachments/assets/5b6a9628-7a90-424c-9341-9c3d0879ad03" />
<img width="2559" height="1387" alt="image" src="https://github.com/user-attachments/assets/bbdc79af-c08c-4f08-939c-f6584c2980ca" />
<img width="2559" height="1388" alt="image" src="https://github.com/user-attachments/assets/f8e88b44-593a-4316-a4b2-3fc2692c757f" />
<img width="2559" height="1386" alt="image" src="https://github.com/user-attachments/assets/3a414e12-ba51-4d4b-805f-c676c293099f" />
<img width="2559" height="1385" alt="image" src="https://github.com/user-attachments/assets/95679f9e-6556-406a-aaea-3b0f39212698" />
<img width="2559" height="1387" alt="image" src="https://github.com/user-attachments/assets/0360c036-dea6-4c24-b86b-fefada008070" />

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
