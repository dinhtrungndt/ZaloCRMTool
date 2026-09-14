const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { chromium } = require('playwright');
const express = require('express');

let mainWindow;
let playwrightPage;

// ==========================================
// 1. KHOI TAO API SERVER VA HANG DOI (QUEUE)
// ==========================================
const expressApp = express();
expressApp.use(express.json());

// Khai báo hàng đợi
const messageQueue = [];
let isProcessingQueue = false;

// Hàm xử lý hàng đợi tuần tự (Ai vào trước gửi trước)
async function processQueue() {
    // Nếu đang xử lý dở người khác, hoặc hết hàng đợi thì dừng
    if (isProcessingQueue || messageQueue.length === 0) return;
    
    isProcessingQueue = true; // Khóa không cho API khác nhảy vào
    const task = messageQueue.shift(); // Lôi yêu cầu đầu tiên ra khỏi hàng
    const { phone, message, resolve, reject } = task;

    try {
        if (mainWindow) mainWindow.webContents.send('log-info', `Processing message to: ${phone}... (Còn ${messageQueue.length} tin đang chờ)`);

        // Automation: Bôi đen và xóa ô tìm kiếm
        await playwrightPage.locator('#contact-search-input').click();
        await playwrightPage.keyboard.down('Control');
        await playwrightPage.keyboard.press('A');
        await playwrightPage.keyboard.up('Control');
        await playwrightPage.keyboard.press('Backspace');
        
        // Automation: Gõ số điện thoại
        await playwrightPage.locator('#contact-search-input').fill(phone);
        await playwrightPage.waitForTimeout(1500);
        
        // Automation: Chọn kết quả
        await playwrightPage.keyboard.press('ArrowDown');
        await playwrightPage.waitForTimeout(200);
        await playwrightPage.keyboard.press('Enter');
        await playwrightPage.waitForTimeout(1000); 

        // CHECK AN TOÀN: Báo lỗi nếu SĐT không tồn tại
        const searchValue = await playwrightPage.locator('#contact-search-input').inputValue();
        if (searchValue === phone) {
            await playwrightPage.locator('#contact-search-input').fill('');
            await playwrightPage.keyboard.press('Escape');
            throw new Error('Không tìm thấy tài khoản Zalo của SĐT/Tên này');
        }
        
        // Automation: Dán tin nhắn và gửi
        const chatInput = playwrightPage.locator('#richInput');
        await chatInput.click();
        
        await chatInput.evaluate((el, text) => {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);
            const event = new ClipboardEvent('paste', {
                clipboardData: dataTransfer,
                bubbles: true
            });
            el.dispatchEvent(event);
        }, message);

        await playwrightPage.waitForTimeout(500);
        await playwrightPage.keyboard.press('Enter');

        // Báo UI thành công
        if (mainWindow) {
            mainWindow.webContents.send('log-info', `[Thành Công] Đã gửi thông báo tới: ${phone}`);
            mainWindow.webContents.send('update-stats', { type: 'success' });
        }
        
        // Trả kết quả về cho hệ thống đã gọi API
        resolve({ success: true, message: 'Message sent successfully' });

    } catch (error) {
        console.error(error);
        if (mainWindow) {
            mainWindow.webContents.send('log-info', `[Thất Bại] Lỗi khi gửi cho ${phone} - ${error.message}`);
            mainWindow.webContents.send('update-stats', { type: 'error' });
        }
        reject(error);
    } finally {
        isProcessingQueue = false; // Mở khóa
        processQueue(); // Tự động gọi đệ quy để xử lý người tiếp theo trong hàng
    }
}

// Endpoint API
expressApp.post('/send-msg', async (req, res) => {
    const { phone, message } = req.body;
    
    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Invalid parameters: phone and message are required' });
    }
    
    if (!playwrightPage) {
        return res.status(500).json({ success: false, error: 'Service unavailable: Zalo is not ready' });
    }

    try {
        // Gom data thành 1 Task, ném vào Queue và chờ (Promise)
        const result = await new Promise((resolve, reject) => {
            messageQueue.push({ phone, message, resolve, reject });
            
            if (mainWindow) {
                mainWindow.webContents.send('log-info', `[System] Nhận API gửi ${phone}. Đã đưa vào hàng đợi vị trí #${messageQueue.length}`);
            }

            // Đánh thức Queue làm việc nếu nó đang rảnh
            processQueue(); 
        });

        res.json(result);
    } catch (error) {
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
        icon: path.join(__dirname, 'icon.ico'),
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
            channel: 'msedge', // Ép dùng Microsoft Edge có sẵn của Windows để file .exe nhẹ và chạy được ở mọi máy
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
