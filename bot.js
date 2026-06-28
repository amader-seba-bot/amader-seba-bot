// ==================== Amader Seba WhatsApp Bot ====================
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ==================== ভেরিয়েবল ====================
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE || '8801834716554';
const PORT = process.env.PORT || 3000;

// ==================== Google Sheets (credentials.json চেক) ====================
let sheets = null;
let googleAuth = null;

try {
    // credentials.json ফাইল আছে কিনা চেক করুন
    const credPath = path.join(__dirname, 'credentials.json');
    if (fs.existsSync(credPath)) {
        console.log('✅ credentials.json পাওয়া গেছে!');
        googleAuth = new google.auth.GoogleAuth({
            keyFile: credPath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        sheets = google.sheets({ version: 'v4', auth: googleAuth });
    } else {
        console.log('⚠️ credentials.json পাওয়া যায়নি। Google Sheets ফিচার বন্ধ থাকবে।');
    }
} catch (error) {
    console.log('⚠️ credentials.json লোড করতে ব্যর্থ:', error.message);
}

// ==================== Google Sheets ফাংশন ====================
async function loadServices() {
    if (!sheets) {
        console.log('⚠️ Google Sheets উপলব্ধ নয়। ডিফল্ট সার্ভিস লোড করা হচ্ছে...');
        return {
            nid: { name: 'NID কার্ড', price: 180, deliveryTime: '১০-২০ মিনিট', fields: ['name', 'nid', 'dob'] },
            lost_id: { name: 'হারানো আইডি কার্ড', price: 1200, deliveryTime: '১-২ ঘন্টা', fields: ['name', 'father', 'mother', 'voter_address', 'division', 'district', 'upazila', 'union', 'ward', 'village'] },
            double_voter: { name: 'ডাবল ভোটার', price: 3500, deliveryTime: '২-৩ ঘন্টা', fields: ['address_type', 'address1', 'address2'] }
        };
    }
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Services!A:E'
        });
        const rows = response.data.values || [];
        const services = {};
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row[0] && row[1]) {
                services[row[0]] = {
                    name: row[1],
                    price: parseInt(row[2]) || 0,
                    deliveryTime: row[3] || 'নতুন অর্ডার',
                    fields: row[4] ? row[4].split(',') : []
                };
            }
        }
        return services;
    } catch (error) {
        console.log('⚠️ Services লোড ব্যর্থ:', error.message);
        return {};
    }
}

// ==================== WhatsApp Client ====================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ==================== QR Code ====================
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('📱 QR Code স্ক্যান করুন!');
});

// ==================== বট রেডি ====================
client.on('ready', () => {
    console.log('✅ বট লাইভ!');
});

// ==================== স্টেট ====================
const userStates = {};
const adminStates = {};

// ==================== মেসেজ ফাংশন ====================
async function sendMessage(to, text) {
    try {
        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        await client.sendMessage(chatId, text);
        return true;
    } catch (error) {
        console.log('❌ মেসেজ পাঠাতে ব্যর্থ:', error.message);
        return false;
    }
}

// ==================== ইমোজি + টেক্সট মেসেজ ====================
async function sendInteractiveMessage(to, text, buttons) {
    try {
        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        
        if (buttons && buttons.length > 0) {
            const buttonRows = buttons.map((btn, index) => ({
                id: btn.id || `btn_${index}`,
                title: btn.title || btn,
                description: btn.description || ''
            }));

            await client.sendMessage(chatId, {
                body: text,
                footer: '👆 বাটনে চাপ দিন',
                buttons: buttonRows,
                title: '📌 সার্ভিস সিলেক্ট করুন'
            });
        } else {
            await client.sendMessage(chatId, text);
        }
        return true;
    } catch (error) {
        console.log('❌ ইন্টারেক্টিভ মেসেজ ব্যর্থ:', error.message);
        // ফ্যালব্যাক: টেক্সট মেসেজ
        await sendMessage(to, text);
        return false;
    }
}

// ==================== সার্ভিস মেনু ====================
async function sendServiceMenu(phoneNumber) {
    const services = await loadServices();
    const serviceKeys = Object.keys(services);
    
    if (serviceKeys.length === 0) {
        await sendMessage(phoneNumber, '❌ কোনো সার্ভিস পাওয়া যায়নি।');
        return;
    }
    
    let menuText = '👋 *স্বাগতম! আমাদের সার্ভিস সিলেক্ট করুন:*\n\n';
    serviceKeys.forEach((key, i) => {
        const s = services[key];
        menuText += `${i+1}. ${s.name} - ${s.price}\n`;
    });
    menuText += `\n📌 সার্ভিসের নাম লিখুন (যেমন: nid) অথবা "menu" লিখুন।`;
    
    const buttons = serviceKeys.slice(0, 3).map(key => ({
        id: `service_${key}`,
        title: `${services[key].name} - ${services[key].price}`
    }));
    
    await sendInteractiveMessage(phoneNumber, menuText, buttons);
    
    if (serviceKeys.length > 3) {
        let moreText = '📌 *আরও সার্ভিস:*\n';
        serviceKeys.slice(3).forEach(key => {
            moreText += `👉 ${services[key].name} - ${services[key].price}\n`;
        });
        await sendMessage(phoneNumber, moreText);
    }
}

// ==================== অর্ডার প্রসেস শুরু ====================
async function startOrderProcess(phoneNumber, serviceId) {
    const services = await loadServices();
    const service = services[serviceId];
    
    if (!service) {
        await sendMessage(phoneNumber, '❌ সার্ভিস খুঁজে পাওয়া যায়নি।');
        return;
    }
    
    await sendMessage(phoneNumber, 
        `✅ *${service.name}* সিলেক্ট করেছেন!\n\n💰 দাম: ${service.price} টাকা\n⏱️ ডেলিভারি সময়: ${service.deliveryTime}\n\n📝 এখন আপনার তথ্য দিন:`
    );
    
    userStates[phoneNumber] = {
        serviceId: serviceId,
        fieldIndex: 0,
        formData: {},
        state: 'collecting',
        service: service
    };
    
    await askNextField(phoneNumber);
}

// ==================== পরবর্তী তথ্য চাওয়া ====================
async function askNextField(phoneNumber) {
    const state = userStates[phoneNumber];
    if (!state) return;
    
    const service = state.service;
    const fields = service.fields;
    const idx = state.fieldIndex;
    
    if (idx >= fields.length) {
        await showConfirmation(phoneNumber);
        return;
    }
    
    const fieldName = fields[idx];
    const fieldLabels = {
        'name': '📛 আপনার নাম',
        'nid': '🆔 NID নম্বর',
        'voter': '🆔 ভোটার নম্বর',
        'from': '🆔 FROM নম্বর',
        'dob': '📅 জন্ম তারিখ',
        'father': '👨 পিতার নাম',
        'mother': '👩 মাতার নাম',
        'voter_address': '📍 ভোটারের ঠিকানা',
        'division': '📌 বিভাগের নাম',
        'district': '📌 জেলার নাম',
        'upazila': '📌 উপজেলার নাম',
        'union': '📌 ইউনিয়ন নাম',
        'ward': '📌 ওয়ার্ড নাম্বার',
        'village': '📌 গ্রামের নাম',
        'address_type': '📍 কোন ঠিকানায় চেক করবেন?\n\n১. এক ঠিকানা\n২. দুই ঠিকানা',
        'address1': '📍 প্রথম ঠিকানা লিখুন',
        'address2': '📍 দ্বিতীয় ঠিকানা লিখুন'
    };
    
    await sendMessage(phoneNumber, `${fieldLabels[fieldName] || fieldName} দিন:`);
}

// ==================== ইউজার ইনপুট ====================
async function handleUserInput(phoneNumber, message) {
    const state = userStates[phoneNumber];
    
    if (!state || state.state === 'menu') {
        await sendServiceMenu(phoneNumber);
        return;
    }
    
    if (state.state === 'collecting') {
        const service = state.service;
        const fields = service.fields;
        const idx = state.fieldIndex;
        const fieldName = fields[idx];
        
        if (fieldName === 'address_type') {
            if (message === '১' || message.toLowerCase() === 'এক' || message.toLowerCase() === '1') {
                state.formData['address_type'] = 'one';
            } else if (message === '২' || message.toLowerCase() === 'দুই' || message.toLowerCase() === '2') {
                state.formData['address_type'] = 'two';
            } else {
                await sendMessage(phoneNumber, '❌ দয়া করে "১" বা "২" লিখুন।');
                return;
            }
        } else {
            state.formData[fieldName] = message;
        }
        
        state.fieldIndex++;
        await askNextField(phoneNumber);
    }
}

// ==================== কনফর্মেশন ====================
async function showConfirmation(phoneNumber) {
    const state = userStates[phoneNumber];
    if (!state) return;
    
    const service = state.service;
    
    let confirmText = `✅ *অর্ডার কনফর্মেশন*\n\n`;
    confirmText += `📦 সার্ভিস: ${service.name}\n`;
    confirmText += `💰 দাম: ${service.price} টাকা\n`;
    confirmText += `⏱️ ডেলিভারি সময়: ${service.deliveryTime}\n\n`;
    confirmText += `📝 আপনার তথ্য:\n`;
    
    const labels = {
        'name': 'নাম', 'nid': 'NID', 'voter': 'ভোটার', 'from': 'FROM',
        'dob': 'জন্ম তারিখ', 'father': 'পিতার নাম', 'mother': 'মাতার নাম',
        'voter_address': 'ভোটারের ঠিকানা', 'division': 'বিভাগ',
        'district': 'জেলা', 'upazila': 'উপজেলা',
        'union': 'ইউনিয়ন', 'ward': 'ওয়ার্ড', 'village': 'গ্রাম',
        'address_type': 'ঠিকানা টাইপ', 'address1': 'প্রথম ঠিকানা',
        'address2': 'দ্বিতীয় ঠিকানা'
    };
    
    Object.keys(state.formData).forEach(key => {
        confirmText += `• ${labels[key] || key}: ${state.formData[key]}\n`;
    });
    
    confirmText += `\nঅর্ডার কনফর্ম করতে "হ্যাঁ" লিখুন।\nবাতিল করতে "না" লিখুন।`;
    
    await sendMessage(phoneNumber, confirmText);
    state.state = 'confirming';
}

// ==================== কনফর্মেশন হ্যান্ডল ====================
async function handleConfirmation(phoneNumber, decision) {
    const state = userStates[phoneNumber];
    if (!state) return;
    
    if (decision === 'হ্যাঁ' || decision.toLowerCase() === 'yes' || decision === 'হ') {
        const service = state.service;
        const orderId = Math.floor(100000 + Math.random() * 900000).toString();
        
        await sendMessage(phoneNumber, 
            `✅ *অর্ডার সফল!*\n\n🆔 অর্ডার আইডি: #${orderId}\n📦 সার্ভিস: ${service.name}\n📊 স্ট্যাটাস: ⏳ পেন্ডিং\n\nআমরা খুব শীঘ্রই ডেলিভারি দেব।`
        );
        
        // অ্যাডমিন নোটিফিকেশন
        const adminText = `🛒 *নতুন অর্ডার!*\n\n🆔 অর্ডার আইডি: #${orderId}\n👤 ইউজার: ${phoneNumber}\n📦 সার্ভিস: ${service.name}\n💰 দাম: ${service.price} টাকা\n📝 তথ্য: ${JSON.stringify(state.formData)}`;
        
        await sendMessage(ADMIN_PHONE, adminText);
        console.log(`📨 নতুন অর্ডার! ID: ${orderId}, Service: ${service.name}`);
        
        delete userStates[phoneNumber];
    } else if (decision === 'না' || decision.toLowerCase() === 'no' || decision === 'ন') {
        await sendMessage(phoneNumber, '❌ অর্ডার বাতিল করা হয়েছে।');
        delete userStates[phoneNumber];
    } else {
        await sendMessage(phoneNumber, '❌ দয়া করে "হ্যাঁ" বা "না" লিখুন।');
    }
}

// ==================== অ্যাডমিন কমান্ড ====================
async function handleAdminCommand(phoneNumber, message) {
    // সিম্পল অ্যাডমিন চেক (শুধু ADMIN_PHONE)
    if (phoneNumber !== ADMIN_PHONE && phoneNumber !== ADMIN_PHONE.replace('880', '')) {
        await sendMessage(phoneNumber, '⛔ আপনি অ্যাডমিন নন।');
        return;
    }

    // ডেলিভারি কমান্ড
    if (message.startsWith('!deliver')) {
        const parts = message.split(' ');
        if (parts.length < 2) {
            await sendMessage(phoneNumber, '⚠️ ফরম্যাট: !deliver ORDER_ID');
            return;
        }
        await sendMessage(phoneNumber, `📦 অর্ডার #${parts[1]} ডেলিভারি দেওয়ার জন্য নির্দেশনা দরকার।`);
        return;
    }

    // পরিসংখ্যান
    if (message === '!stats') {
        await sendMessage(phoneNumber, '📊 পরিসংখ্যান দেখার জন্য Google Sheets সংযোগ প্রয়োজন।');
        return;
    }

    // সব সার্ভিস
    if (message === '!services') {
        const services = await loadServices();
        let text = '📋 *সব সার্ভিস:*\n\n';
        Object.keys(services).forEach(key => {
            const s = services[key];
            text += `🆔 ${key}\n📦 ${s.name}\n💰 ${s.price} টাকা\n⏱️ ${s.deliveryTime}\n\n`;
        });
        await sendMessage(phoneNumber, text);
        return;
    }

    // হেল্প
    if (message === '!help') {
        const helpText = `👑 *অ্যাডমিন হেল্প*\n\n` +
            `📦 অর্ডার ম্যানেজমেন্ট:\n` +
            `!deliver ORDER_ID\n\n` +
            `📊 পরিসংখ্যান:\n` +
            `!stats\n\n` +
            `📋 সার্ভিস:\n` +
            `!services\n\n` +
            `📌 ইউজার কমান্ড:\n` +
            `menu - সার্ভিস দেখে`;
        await sendMessage(phoneNumber, helpText);
        return;
    }
}

// ==================== মেসেজ হ্যান্ডলার ====================
client.on('message', async message => {
    const phoneNumber = message.from.replace('@c.us', '');
    const text = message.body;

    console.log(`📩 মেসেজ পেয়েছি: ${phoneNumber} -> ${text}`);

    // অ্যাডমিন কমান্ড
    if (text.startsWith('!')) {
        await handleAdminCommand(phoneNumber, text);
        return;
    }

    // মেনু কমান্ড
    if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'start' || text.toLowerCase() === 'হ্যালো') {
        await sendServiceMenu(phoneNumber);
        return;
    }

    // ইউজার কনফর্মেশন
    const state = userStates[phoneNumber];
    if (state && state.state === 'confirming') {
        await handleConfirmation(phoneNumber, text);
        return;
    }

    // সার্ভিস সিলেক্ট (ইউজার সরাসরি সার্ভিস আইডি লিখলে)
    const services = await loadServices();
    if (services[text]) {
        await startOrderProcess(phoneNumber, text);
        return;
    }

    // সাধারণ ইউজার ইনপুট
    await handleUserInput(phoneNumber, text);
});

// ==================== ওয়েবহুক ====================
app.get('/', (req, res) => {
    res.send('🤖 WhatsApp বট লাইভ!');
});

app.get('/qr', (req, res) => {
    res.send('📱 QR Code দেখতে কনসোল চেক করুন।');
});

// ==================== সার্ভার চালু ====================
client.initialize();

app.listen(PORT, () => {
    console.log(`🌐 ওয়েব সার্ভার চালু! পোর্ট: ${PORT}`);
    console.log(`📱 QR Code এর জন্য /qr এ যান`);
});
