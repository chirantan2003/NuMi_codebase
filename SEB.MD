# Project Context

**NOTE: This is NOT an embedded firmware project.**

This project is a browser extension (Chrome/Firefox manifest v3) with a Python backend server. It does not contain embedded systems code, MCU firmware, or hardware-related components.

## Project Type
- **Type**: Browser Extension + Python Backend
- **Platform**: Web (Chrome/Firefox)
- **Language**: JavaScript (frontend), Python (backend)

## Project Components
- **Browser Extension**: Food recommendation system for DoorDash and UberEats
- **Content Scripts**: `content.js`, `interceptor.js`, `background.js`
- **Backend Server**: `server.py` (Flask/Python)
- **Analysis Tool**: `analyzer.py`

## Target Environment
- **Host OS**: Darwin (macOS)
- **Runtime**: Browser (Chrome/Firefox)
- **Backend**: Python 3.13 (virtual environment)
- **Server**: Flask development server (localhost:5000)

## Project Notes
The SEB.MD template is designed for embedded firmware projects with microcontrollers, hardware peripherals, and real-time constraints. This project does not fit that category and should use a different documentation template appropriate for web extensions or full-stack applications.
