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
        // B2. Gõ số điện thoại (hoặc tên người dùng)
        await playwrightPage.locator('#contact-search-input').fill(phone);
        await playwrightPage.waitForTimeout(1500); // Đợi Zalo loading kết quả tìm kiếm
        
        // B3. Bấm phím mũi tên Xuống để chọn người đầu tiên, rồi Enter mở Chat
        await playwrightPage.keyboard.press('ArrowDown');
        await playwrightPage.waitForTimeout(200);
        await playwrightPage.keyboard.press('Enter');
        await playwrightPage.waitForTimeout(1000); // Đợi giao diện chat bên phải mở ra
        
        // 🛑 CHỐT CHẶN AN TOÀN: KIỂM TRA XEM CÓ TÌM THẤY NGƯỜI KHÔNG
        // Nếu tìm thành công và chọn được người, Zalo sẽ tự đóng panel và xóa trắng ô tìm kiếm.
        // Nếu ô tìm kiếm vẫn còn y nguyên số điện thoại => Tức là không tìm thấy ai!
        const searchValue = await playwrightPage.locator('#contact-search-input').inputValue();
        if (searchValue === phone) {
            // Bấm Esc hoặc xóa trắng để thoát trạng thái tìm kiếm ảo
            await playwrightPage.locator('#contact-search-input').fill('');
            await playwrightPage.keyboard.press('Escape');
            throw new Error('Không tìm thấy tài khoản Zalo của SĐT/Tên này (Bị chặn hoặc chưa đk)');
        }

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

        if (mainWindow) {
            mainWindow.webContents.send('log-info', `[Thành Công] Đã gửi thông báo tới: ${phone}`);
            mainWindow.webContents.send('update-stats', { type: 'success' });
        }
        res.json({ success: true, message: 'Message sent successfully' });

    } catch (error) {
        console.error(error);
        if (mainWindow) {
            mainWindow.webContents.send('log-info', `[Thất Bại] Lỗi khi gửi cho ${phone} - ${error.message}`);
            mainWindow.webContents.send('update-stats', { type: 'error' });
        }
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
