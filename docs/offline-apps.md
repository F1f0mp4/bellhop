# Making and coding apps, offline

How to install and set up FreeCAD, OrcaSlicer, Ollama, Zed, Arduino IDE and Thonny on Mac, Windows
and Linux, so they keep working when the internet doesn't.

All the installers come from the **Apps** page in Bellhop. Bellhop downloads them from each project's
GitHub and keeps a copy on the server, checking every 12 hours for a new **stable** release (preview
builds, release candidates, nightlies and FreeCAD's weekly builds are skipped). Open an app, pick your
platform, press **Download**.

- [Do this while you're online](#do-this-while-youre-online)
- [Installing the apps](#installing-the-apps): [Mac](#mac) · [Windows](#windows) · [Linux](#linux)
- [Ollama: local AI](#ollama-local-ai)
- [Zed: AI code editor](#zed-ai-code-editor)
- [Arduino and Raspberry Pi](#arduino-and-raspberry-pi)

## Do this while you're online

The installers are on the server, but a few things are downloaded the first time you use them. Do
these once, on every computer, while you still have internet:

1. **Ollama:** download the models you want (see [models](#pick-a-model)).
2. **Zed:** open one `.py` file and one `.c` file. Zed fetches its Python and C tools (pyright, clangd)
   the first time and keeps them.
3. **Arduino IDE:** install the board packages and libraries you use (Tools → Board → Boards Manager,
   and Sketch → Include Library → Manage Libraries).
4. **Thonny:** if you use a Raspberry Pi Pico or ESP32, let Thonny install MicroPython on it once
   (bottom-right corner → Configure interpreter → Install or update MicroPython).

After that nothing here needs the internet.

## Installing the apps

### Mac

Downloads come as `.dmg` (FreeCAD, OrcaSlicer, Ollama, Zed, Arduino IDE) or `.pkg` (Thonny). Pick
**Apple silicon** for M1 and newer, **Intel** for older Macs ( → About This Mac → Chip).

- **`.dmg`:** open it and drag the app into **Applications**.
- **`.pkg`:** double-click it and follow the installer.

If macOS says it can't check the app for malware, open **System Settings → Privacy & Security**,
scroll down and press **Open Anyway**. Without internet macOS can't reach Apple to check the
signature, so expect this more often offline.

### Windows

Run the `.exe` and follow the installer. If **Windows protected your PC** appears, press
**More info → Run anyway**.

- **Thonny** asks whether to install for you or for everyone; either is fine.
- **Arduino IDE** offers to install USB drivers at the end. Say yes, or boards won't show up.

### Linux

Downloads are `.AppImage` (FreeCAD, OrcaSlicer, Arduino IDE) or `.tar.gz` / `.tar.zst` archives (Zed,
Ollama). Pick **ARM** on a Raspberry Pi and **x86_64** on a normal PC (`uname -m` prints
`aarch64` or `x86_64`).

**AppImage:** make it runnable, then start it:

```bash
chmod +x ~/Downloads/FreeCAD_*.AppImage
```

```bash
~/Downloads/FreeCAD_*.AppImage
```

If it complains about FUSE, install it once (Ubuntu 24.04 and newer, Debian, Raspberry Pi OS):

```bash
sudo apt install libfuse2t64
```

On Ubuntu 22.04 the package is called `libfuse2`. Move AppImages somewhere permanent, like
`~/Applications`, rather than leaving them in Downloads.

**Zed** (`zed-linux-x86_64.tar.gz` or `zed-linux-aarch64.tar.gz`):

```bash
mkdir -p ~/.local/bin ~/.local/share/applications && tar -xzf ~/Downloads/zed-linux-*.tar.gz -C ~/.local
```

```bash
ln -sf ~/.local/zed.app/bin/zed ~/.local/bin/zed
```

```bash
sed -e "s|Icon=zed|Icon=$HOME/.local/zed.app/share/icons/hicolor/512x512/apps/zed.png|" -e "s|Exec=zed|Exec=$HOME/.local/zed.app/bin/zed|" "$(ls ~/.local/zed.app/share/applications/*.desktop | head -n1)" > ~/.local/share/applications/dev.zed.Zed.desktop
```

Zed is now in the app menu, and `zed .` opens the current folder from a terminal.

**Ollama:** see [Ollama on Linux](#on-linux).

**Thonny:** already installed on Raspberry Pi OS. On other distributions:

```bash
sudo apt install thonny
```

## Ollama: local AI

Ollama runs AI models on your own computer. Zed talks to it for code help, and once a model is
downloaded nothing leaves the house and nothing needs the internet.

### Install

- **Mac:** open `Ollama.dmg`, drag Ollama to Applications and start it. A llama icon appears in the
  menu bar.
- **Windows:** run `OllamaSetup.exe`. Ollama starts on its own and sits in the system tray.

#### On Linux

```bash
sudo apt install zstd
```

```bash
sudo tar -C /usr -xf ~/Downloads/ollama-linux-*.tar.zst
```

To start it with the computer, create a service:

```bash
sudo useradd -r -s /bin/false -U -m -d /usr/share/ollama ollama
```

```bash
sudo tee /etc/systemd/system/ollama.service > /dev/null <<'EOF'
[Unit]
Description=Ollama
After=network-online.target

[Service]
ExecStart=/usr/bin/ollama serve
User=ollama
Group=ollama
Restart=always

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ollama
```

### Pick a model

Download models from a terminal (Terminal on Mac, PowerShell on Windows) **while online**:

```bash
ollama pull qwen2.5-coder:7b
```

| Computer                                   | Model for coding     | Download size |
| ------------------------------------------ | -------------------- | ------------- |
| 8 GB of memory, Raspberry Pi 5             | `qwen2.5-coder:3b`   | about 2 GB    |
| 16 GB                                      | `qwen2.5-coder:7b`   | about 5 GB    |
| 32 GB or more, or a GPU with 16 GB+        | `qwen2.5-coder:14b`  | about 9 GB    |

For general chat add `llama3.2` or `gemma3`. Check it works:

```bash
ollama run qwen2.5-coder:7b "Write a C function that reverses a string"
```

`ollama list` shows what's downloaded.

### Share one Ollama with the whole house (optional)

Instead of every computer downloading its own models, run Ollama on the most powerful computer and let
the others use it. On that computer, let Ollama accept connections from the network:

- **Mac:** run this, then quit and reopen Ollama:

  ```bash
  launchctl setenv OLLAMA_HOST 0.0.0.0
  ```

- **Windows:** Start → *Edit environment variables for your account* → **New**, name `OLLAMA_HOST`,
  value `0.0.0.0`. Quit Ollama from the tray and start it again.
- **Linux:** run `sudo systemctl edit ollama`, add these two lines, save, then
  `sudo systemctl restart ollama`:

  ```ini
  [Service]
  Environment="OLLAMA_HOST=0.0.0.0"
  ```

The other computers then use `http://<that computer's address>:11434` in Zed (below) and don't need
Ollama installed at all. Anyone on your network can use it, so only do this on a network you trust.

## Zed: AI code editor

Zed is an open source code editor with an AI agent that reads and edits your project, like Cursor.
Here it uses Ollama instead of a cloud service.

### Connect it to Ollama

Open settings with **Cmd+,** (Mac) or **Ctrl+,** (Windows, Linux) and add:

```json
{
  "language_models": {
    "ollama": {
      "api_url": "http://localhost:11434"
    }
  },
  "agent": {
    "default_model": {
      "provider": "ollama",
      "model": "qwen2.5-coder:7b"
    }
  }
}
```

Use the model you pulled. If Ollama runs on another computer, replace `localhost` with its address.

Then open the **Agent panel** (the sparkle icon at the bottom right, or **Cmd/Ctrl+?**) and ask it to
do something, like *"add a function that reads the temperature sensor every second"*. For an edit in
place, select code and press **Ctrl+Enter** (inline assist).

Zed's tab completions (*edit predictions*) use Zed's own online service. Without internet they simply
stop; the Agent panel and inline assist keep working through Ollama.

### Python and C

- **Python:** open a folder with `.py` files. Run code in the terminal (**Ctrl+`**):
  `python3 main.py`. On Windows, install Python from the Microsoft Store or python.org first.
- **C and C++:** Zed uses clangd for errors and completions. You still need a compiler:
  - Mac: `xcode-select --install`
  - Linux: `sudo apt install build-essential`
  - Windows: easiest is MSYS2 (msys2.org), then `pacman -S mingw-w64-ucrt-x86_64-gcc` in its terminal.

  Compile and run in Zed's terminal: `gcc main.c -o main && ./main`.

Remember to open one file of each kind while online so Zed can fetch its tools.

## Arduino and Raspberry Pi

**Arduino boards (C/C++):** use the **Arduino IDE**. Plug in the board, pick it from the drop-down at
the top, write the sketch and press **Upload** (→). **Tools → Serial Monitor** shows what it prints.
For ESP32 or Raspberry Pi Pico, add their board package in Boards Manager while online.

On **Linux**, let your user talk to USB boards once, then log out and back in:

```bash
sudo usermod -aG dialout $USER
```

**Raspberry Pi Pico and ESP32 (MicroPython):** use **Thonny**. Plug in the board, choose
**MicroPython (Raspberry Pi Pico)** or **(ESP32)** in the bottom-right corner, and press **Run**. Save
as `main.py` on the device to run it every time the board powers on.

**Raspberry Pi computers (Python and C):** Thonny comes with Raspberry Pi OS. For bigger projects,
install Zed (the ARM download) on the Pi, or edit from your main computer with Zed's remote editing:
**File → Open Remote** and the Pi's address over SSH. Use `gpiozero` in Python to drive pins:

```python
from gpiozero import LED
from time import sleep

led = LED(17)
while True:
    led.toggle()
    sleep(0.5)
```

## When something doesn't work

- **The Apps page has no download for an app:** Bellhop hasn't fetched it yet. An admin can press
  **Check for updates** under **Manage apps**; big files like Ollama (1.5 GB) take a while.
- **Zed says it can't reach the model:** check Ollama is running (`ollama list` answers), and that the
  model name in settings matches `ollama list` exactly.
- **The AI is very slow:** the model is too big for the computer. Pull the next smaller one from the
  table above.
- **Arduino board doesn't show up:** try another USB cable (many only charge), and on Linux check the
  `dialout` step above.
