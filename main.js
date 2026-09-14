const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { chromium } = require('playwright');
const express = require('express');

let mainWindow;
let playwrightPage;

// ==========================================
// 1. KHOI TAO API SERVER (ZALO SENDER)
// ==========================================
const expressApp = express();
expressApp.use(express.json());

expressApp.post('/send-msg', async (req, res) => {
    const { phone, message } = req.body;
    
    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Invalid parameters: phone and message are required' });
    }
    
    if (!playwrightPage) {
        return res.status(500).json({ success: false, error: 'Service unavailable: Zalo is not ready' });
    }

    try {
        if (mainWindow) mainWindow.webContents.send('log-info', `Processing message to: ${phone}...`);

        // Automation: Search contact
        await playwrightPage.locator('#contact-search-input').click();
        await playwrightPage.keyboard.down('Control');
        await playwrightPage.keyboard.press('A');
        await playwrightPage.keyboard.up('Control');
        await playwrightPage.keyboard.press('Backspace');
        
        await playwrightPage.locator('#contact-search-input').fill(phone);
        await playwrightPage.waitForTimeout(1500);
        
        // Automation: Select target contact
        await playwrightPage.keyboard.press('ArrowDown');
        await playwrightPage.waitForTimeout(200);
        await playwrightPage.keyboard.press('Enter');
        await playwrightPage.waitForTimeout(1000); 
        
        // B4. Focus vào ô soạn tin nhắn và gõ chữ
        const chatInput = playwrightPage.locator('#richInput');
        await chatInput.click();
        
        // Mô phỏng hành động Dán (Paste - Ctrl+V) để giữ nguyên định dạng, xuống dòng, emoji
        // Tránh hoàn toàn lỗi gõ phím của trình duyệt
        await chatInput.evaluate((el, text) => {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);
            const event = new ClipboardEvent('paste', {
                clipboardData: dataTransfer,
                bubbles: true
            });
            el.dispatchEvent(event);
        }, message);

        // B5. Bấm Enter để gửi đi
        await playwrightPage.waitForTimeout(500);
        await playwrightPage.keyboard.press('Enter');

        if (mainWindow) mainWindow.webContents.send('log-info', `Success: Message sent to ${phone}`);
        res.json({ success: true, message: 'Message sent successfully' });

    } catch (error) {
        console.error(error);
        if (mainWindow) mainWindow.webContents.send('log-info', `Error: Failed to send to ${phone} - ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

expressApp.listen(3000, () => {
    console.log('Zalo API Service is running on port 3000');
});

// ==========================================
// 2. KHOI TAO ELECTRON & PLAYWRIGHT
// ==========================================
async function createElectronWindow() {
    mainWindow = new BrowserWindow({
        width: 850,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile('index.html');
}

async function startPlaywright() {
    const userDataDir = path.join(app.getPath('userData'), 'zalo_session');
    
    try {
        const playwrightContext = await chromium.launchPersistentContext(userDataDir, {
            headless: false, 
            args: ['--disable-blink-features=AutomationControlled'],
            viewport: { width: 1000, height: 800 }
        });

        const pages = playwrightContext.pages();
        playwrightPage = pages.length > 0 ? pages[0] : await playwrightContext.newPage();
        
        await playwrightPage.goto('https://chat.zalo.me');

        if (mainWindow) {
            mainWindow.webContents.send('log-info', 'System ready. API listening on Port 3000.');
        }

    } catch (error) {
        console.error("Playwright Error:", error);
    }
}

app.whenReady().then(async () => {
    await createElectronWindow();
    await startPlaywright();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
