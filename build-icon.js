const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const fs = require('fs');

async function convertIcon() {
    try {
        console.log('Đang chuyển đổi icon.svg sang icon.png...');
        await sharp('icon.svg')
            .resize(256, 256)
            .png()
            .toFile('icon.png');
            
        console.log('Đang tạo file icon.ico cho Windows...');
        const buf = await pngToIco('icon.png');
        fs.writeFileSync('icon.ico', buf);
        
        console.log('Xong! Đã tạo thành công icon.ico');
    } catch (err) {
        console.error('Lỗi khi convert icon:', err);
    }
}

convertIcon();
