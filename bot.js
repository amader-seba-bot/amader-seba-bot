// ==================== কনফিগ ====================
const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

// ==================== ভেরিয়েবল ====================
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const PORT = process.env.PORT || 3000;

// ==================== Google Sheets ====================
const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ==================== WhatsApp Client ====================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('📱 QR Code স্ক্যান করুন!');
});

client.on('ready', () => {
    console.log('✅ বট লাইভ!');
});

// ==================== স্টেট ====================
const userStates = {};
const adminStates = {};

// ==================== ১. সার্ভিস লোড ====================
async function loadServices() {
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
        console.error('Services লোড ব্যর্থ:', error.message);
        return {};
    }
}

// ==================== ২. অর্ডার সেভ ====================
async function saveOrder(userPhone, serviceId, serviceName, amount, formData) {
    try {
        const orderId = Math.floor(100000 + Math.random() * 900000).toString();
        const now = new Date().toISOString();
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Orders!A:K',
            valueInputOption: 'RAW',
            requestBody: {
                values: [[
                    orderId,
                    userPhone,
                    serviceId,
                    serviceName,
                    amount,
                    JSON.stringify(formData),
                    'pending',
                    '',
                    '',
                    now,
                    ''
                ]]
            }
        });
        return orderId;
    } catch (error) {
        console.error('অর্ডার সেভ ব্যর্থ:', error.message);
        return null;
    }
}

// ==================== ৩. অর্ডার আপডেট ====================
async function updateOrder(orderId, status, deliveryType, deliveryContent, cancelReason = '') {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Orders!A:K'
        });
        const rows = response.data.values || [];
        
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === orderId) {
                rows[i][6] = status;
                if (deliveryType) rows[i][7] = deliveryType;
                if (deliveryContent) rows[i][8] = deliveryContent;
                if (cancelReason) rows[i][10] = cancelReason;
                
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range: `Orders!A${i+1}:K${i+1}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [rows[i]] }
                });
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('অর্ডার আপডেট ব্যর্থ:', error.message);
        return false;
    }
}

// ==================== ৪. অর্ডার ডিটেইলস ====================
async function getOrderDetails(orderId) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Orders!A:K'
        });
        const rows = response.data.values || [];
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === orderId) {
                return {
                    orderId: rows[i][0],
                    userPhone: rows[i][1],
                    serviceId: rows[i][2],
                    serviceName: rows[i][3],
                    amount: rows[i][4],
                    formData: rows[i][5] ? JSON.parse(rows[i][5]) : {},
                    status: rows[i][6],
                    deliveryType: rows[i][7],
                    deliveryContent: rows[i][8],
                    createdAt: rows[i][9],
                    cancelReason: rows[i][10] || ''
                };
            }
        }
        return null;
    } catch (error) {
        console.error('অর্ডার ডিটেইলস ব্যর্থ:', error.message);
        return null;
    }
}

// ==================== ৫. অ্যাডমিন চেক ====================
async function isAdmin(phone) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Admins!A:A'
        });
        const rows = response.data.values || [];
        return rows.some(row => row[0] === phone);
    } catch (error) {
        return phone === ADMIN_PHONE;
    }
}

// ==================== ৬. মেসেজ ফাংশন ====================
async function sendMessage(to, text) {
    try {
        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        await client.sendMessage(chatId, text);
    } catch (error) {
        console.error('মেসেজ পাঠাতে ব্যর্থ:', error.message);
    }
}

// ==================== ৭. ইন্টারেক্টিভ মেসেজ (বাটন সহ) ====================
async function sendInteractiveMessage(to, text, buttons) {
    try {
        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        
        const buttonRows = buttons.map((btn, index) => ({
            id: btn.id || `btn_${index}`,
            title: btn.title || btn,
            description: btn.description || ''
        }));

        await client.sendMessage(chatId, {
            body: text,
            footer: '👆 বাটনে চাপ দিন',
            buttons: buttonRows,
            title: '📌 অর্ডার ডিটেইলস'
        });
    } catch (error) {
        console.error('ইন্টারেক্টিভ মেসেজ ব্যর্থ:', error.message);
        await sendMessage(to, text + '\n\n' + buttons.map(b => `👉 ${b.title || b}`).join('\n'));
    }
}

// ==================== ৮. সার্ভিস মেনু (বাটন সহ) ====================
async function sendServiceMenu(phoneNumber) {
    const services = await loadServices();
    const serviceKeys = Object.keys(services);
    
    if (serviceKeys.length === 0) {
        await sendMessage(phoneNumber, '❌ কোনো সার্ভিস পাওয়া যায়নি।');
        return;
    }
    
    let menuText = '👋 স্বাগতম! আমাদের সার্ভিস সিলেক্ট করুন:\n\n';
    serviceKeys.forEach((key, i) => {
        const s = services[key];
        menuText += `${i+1}. ${s.name} - ${s.price}\n`;
    });
    menuText += `\n📌 বাটনে চাপ দিন অথবা সার্ভিসের নাম লিখুন (যেমন: nid)`;
    
    const buttons = serviceKeys.slice(0, 3).map(key => ({
        id: `service_${key}`,
        title: `${services[key].name} - ${services[key].price}`
    }));
    
    await sendInteractiveMessage(phoneNumber, menuText, buttons);
    
    if (serviceKeys.length > 3) {
        let moreText = '📌 আরও সার্ভিস:\n';
        serviceKeys.slice(3).forEach(key => {
            moreText += `👉 ${services[key].name} - ${services[key].price}\n`;
        });
        await sendMessage(phoneNumber, moreText);
    }
}

// ==================== ৯. অর্ডার প্রসেস শুরু ====================
async function startOrderProcess(phoneNumber, serviceId) {
    const services = await loadServices();
    const service = services[serviceId];
    
    if (!service) {
        await sendMessage(phoneNumber, '❌ সার্ভিস খুঁজে পাওয়া যায়নি।');
        return;
    }
    
    await sendMessage(phoneNumber, 
        `✅ ${service.name} সিলেক্ট করেছেন!\n\n💰 দাম: ${service.price} টাকা\n⏱️ ডেলিভারি সময়: ${service.deliveryTime}\n\n📝 এখন আপনার তথ্য দিন:`
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

// ==================== ১০. পরবর্তী তথ্য চাওয়া ====================
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

// ==================== ১১. ইউজার ইনপুট ====================
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

// ==================== ১২. কনফর্মেশন ====================
async function showConfirmation(phoneNumber) {
    const state = userStates[phoneNumber];
    if (!state) return;
    
    const service = state.service;
    
    let confirmText = `✅ অর্ডার কনফর্মেশন\n\n`;
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
    
    confirmText += `\nঅর্ডার কনফর্ম করতে "হ্যাঁ" লিখুন। বাতিল করতে "না" লিখুন।`;
    
    await sendMessage(phoneNumber, confirmText);
    state.state = 'confirming';
}

// ==================== ১৩. কনফর্মেশন হ্যান্ডল ====================
async function handleConfirmation(phoneNumber, decision) {
    const state = userStates[phoneNumber];
    if (!state) return;
    
    if (decision.toLowerCase() === 'হ্যাঁ' || decision.toLowerCase() === 'yes' || decision.toLowerCase() === 'হ') {
        const service = state.service;
        const orderId = await saveOrder(
            phoneNumber,
            state.serviceId,
            service.name,
            service.price,
            state.formData
        );
        
        if (!orderId) {
            await sendMessage(phoneNumber, '❌ অর্ডার সেভ করতে ব্যর্থ হয়েছে।');
            delete userStates[phoneNumber];
            return;
        }
        
        // অর্ডার সফল মেসেজ (👁️ তথ্য দেখুন বাটন সহ)
        await sendInteractiveMessage(phoneNumber, 
            `✅ অর্ডার সফল!\n\n🆔 অর্ডার আইডি: #${orderId}\n📦 সার্ভিস: ${service.name}`,
            [
                { id: `view_order_${orderId}`, title: '👁️ তথ্য দেখুন' }
            ]
        );
        
        const adminText = `🛒 নতুন অর্ডার!\n\n🆔 অর্ডার আইডি: #${orderId}\n👤 ইউজার: ${phoneNumber}\n📦 সার্ভিস: ${service.name}\n💰 দাম: ${service.price} টাকা\n📝 তথ্য: ${JSON.stringify(state.formData)}\n\nডেলিভারি দিতে: !deliver ${orderId}`;
        
        await sendMessage(ADMIN_PHONE, adminText);
        
        delete userStates[phoneNumber];
    } else if (decision.toLowerCase() === 'না' || decision.toLowerCase() === 'no' || decision.toLowerCase() === 'ন') {
        await sendMessage(phoneNumber, '❌ অর্ডার বাতিল করা হয়েছে।');
        delete userStates[phoneNumber];
    } else {
        await sendMessage(phoneNumber, '❌ দয়া করে "হ্যাঁ" বা "না" লিখুন।');
    }
}

// ==================== ১৪. অর্ডার ডিটেইলস (👁️ তথ্য দেখুন) ====================
async function sendOrderDetails(phoneNumber, orderId) {
    const order = await getOrderDetails(orderId);
    if (!order) {
        await sendMessage(phoneNumber, '❌ অর্ডার খুঁজে পাওয়া যায়নি।');
        return;
    }
    
    const services = await loadServices();
    const service = services[order.serviceId];
    
    let detailsText = `📋 অর্ডারের বিস্তারিত তথ্য\n\n`;
    detailsText += `━━━━━━━━━━━━━━━━━━━━\n`;
    
    try {
        const formData = JSON.parse(order.formData);
        const labels = {
            'name': '📛 নাম', 'nid': '🆔 NID', 'voter': '🆔 ভোটার',
            'from': '🆔 FROM', 'dob': '📅 জন্ম তারিখ',
            'father': '👨 পিতার নাম', 'mother': '👩 মাতার নাম',
            'voter_address': '📍 ভোটারের ঠিকানা',
            'division': '📌 বিভাগ', 'district': '📌 জেলা',
            'upazila': '📌 উপজেলা', 'union': '📌 ইউনিয়ন',
            'ward': '📌 ওয়ার্ড', 'village': '📌 গ্রাম',
            'address_type': '📌 ঠিকানা টাইপ',
            'address1': '📌 প্রথম ঠিকানা',
            'address2': '📌 দ্বিতীয় ঠিকানা'
        };
        Object.keys(formData).forEach(key => {
            detailsText += `${labels[key] || key}: ${formData[key]}\n`;
        });
    } catch(e) {
        detailsText += `📝 তথ্য: ${order.formData}`;
    }
    
    detailsText += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    detailsText += `💰 দাম: ${order.amount} টাকা\n`;
    detailsText += `⏱️ সময়: ${service?.deliveryTime || 'অজানা'}\n`;
    
    const statusEmoji = order.status === 'pending' ? '⏳' : (order.status === 'delivered' ? '✅' : '❌');
    const statusText = order.status === 'pending' ? 'পেন্ডিং' : (order.status === 'delivered' ? 'সফল' : 'বাতিল');
    detailsText += `📊 স্ট্যাটাস: ${statusEmoji} ${statusText}`;
    
    if (order.status === 'delivered' && order.deliveryContent) {
        detailsText += `\n\n📝 ডেলিভারি মেসেজ:\n${order.deliveryContent}`;
    }
    
    if (order.status === 'cancelled' && order.cancelReason) {
        detailsText += `\n\n❌ বাতিলের কারণ: ${order.cancelReason}`;
    }
    
    detailsText += `\n━━━━━━━━━━━━━━━━━━━━`;
    
    await sendMessage(phoneNumber, detailsText);
}

// ==================== ১৫. অ্যাডমিন ডেলিভারি ====================
async function handleAdminDelivery(phoneNumber, orderId, deliveryType, content) {
    const success = await updateOrder(orderId, 'delivered', deliveryType, content);
    
    if (!success) {
        await sendMessage(phoneNumber, '❌ অর্ডার খুঁজে পাওয়া যায়নি।');
        return;
    }
    
    const order = await getOrderDetails(orderId);
    if (order) {
        let deliveryContentText = '';
        if (deliveryType === 'pdf') {
            deliveryContentText = `📎 PDF লিংক:\n${content}`;
        } else {
            deliveryContentText = `📝 ${content}`;
        }
        
        await sendInteractiveMessage(order.userPhone, 
            `✅ অ্যাডমিন আপনার ডেলিভারি পাঠিয়েছে\n\n📦 সার্ভিস: ${order.serviceName}`,
            [
                { id: `view_order_${orderId}`, title: '👁️ তথ্য দেখুন' }
            ]
        );
        
        await sendMessage(order.userPhone, 
            `${deliveryContentText}\n\nধন্যবাদ!`
        );
        
        await sendMessage(phoneNumber, `✅ অর্ডার #${orderId} ডেলিভারি সম্পন্ন!`);
    }
    
    delete adminStates[phoneNumber];
}

// ==================== ১৬. অ্যাডমিন বাতিল ====================
async function handleAdminCancel(phoneNumber, orderId, reason) {
    const success = await updateOrder(orderId, 'cancelled', '', '', reason);
    
    if (!success) {
        await sendMessage(phoneNumber, '❌ অর্ডার খুঁজে পাওয়া যায়নি।');
        return;
    }
    
    const order = await getOrderDetails(orderId);
    if (order) {
        await sendMessage(order.userPhone, 
            `❌ অর্ডার বাতিল করা হয়েছে\n\nকারণ: ${reason}\n\nযোগাযোগ: ${ADMIN_PHONE}`
        );
        
        await sendMessage(phoneNumber, `✅ অর্ডার #${orderId} বাতিল করা হয়েছে!\nকারণ: ${reason}`);
    }
}

// ==================== ১৭. অ্যাডমিন কমান্ড ====================
async function handleAdminCommand(phoneNumber, message) {
    if (!await isAdmin(phoneNumber)) {
        await sendMessage(phoneNumber, '⛔ আপনি অ্যাডমিন নন।');
        return;
    }

    // ========== ১. নতুন সার্ভিস যোগ ==========
    if (message.startsWith('!addservice')) {
        const parts = message.split('|');
        if (parts.length < 5) {
            await sendMessage(phoneNumber, '⚠️ ফরম্যাট: !addservice ServiceID|নাম|দাম|সময়|ফিল্ড1,ফিল্ড2\nউদাহরণ: !addservice nid|NID কার্ড|180|১০-২০ মিনিট|name,nid,dob');
            return;
        }
        
        const serviceId = parts[0].replace('!addservice', '').trim();
        const name = parts[1].trim();
        const price = parts[2].trim();
        const time = parts[3].trim();
        const fields = parts[4].trim();
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Services!A:E',
            valueInputOption: 'RAW',
            requestBody: {
                values: [[serviceId, name, parseInt(price), time, fields]]
            }
        });
        
        await sendMessage(phoneNumber, `✅ নতুন সার্ভিস যোগ করা হয়েছে!\n\n🆔 ${serviceId}\n📦 ${name}\n💰 ${price} টাকা\n⏱️ ${time}`);
        return;
    }

    // ========== ২. সার্ভিস এডিট ==========
    if (message.startsWith('!editservice')) {
        const parts = message.split('|');
        if (parts.length < 5) {
            await sendMessage(phoneNumber, '⚠️ ফরম্যাট: !editservice ServiceID|নাম|দাম|সময়|ফিল্ড');
            return;
        }
        
        const serviceId = parts[0].replace('!editservice', '').trim();
        const name = parts[1].trim();
        const price = parts[2].trim();
        const time = parts[3].trim();
        const fields = parts[4].trim();
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Services!A:E'
        });
        const rows = response.data.values || [];
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === serviceId) {
                rows[i][1] = name;
                rows[i][2] = parseInt(price);
                rows[i][3] = time;
                rows[i][4] = fields;
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range: `Services!A${i+1}:E${i+1}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [rows[i]] }
                });
                break;
            }
        }
        
        await sendMessage(phoneNumber, `✅ সার্ভিস আপডেট করা হয়েছে!\n\n🆔 ${serviceId}`);
        return;
    }

    // ========== ৩. সার্ভিস ডিলিট ==========
    if (message.startsWith('!deleteservice')) {
        const serviceId = message.replace('!deleteservice', '').trim();
        if (!serviceId) {
            await sendMessage(phoneNumber, '⚠️ ফরম্যাট: !deleteservice ServiceID');
            return;
        }
        await sendMessage(phoneNumber, `✅ সার্ভিস ডিলিট করা হয়েছে!`);
        return;
    }

    // ========== ৪. ডেলিভারি ==========
    if (message.startsWith('!deliver')) {
        const parts = message.split(' ');
        if (parts.length < 2) {
            await sendMessage(phoneNumber, '⚠️ ফরম্যাট: !deliver ORDER_ID');
            return;
        }
        const orderId = parts[1];
        adminStates[phoneNumber] = { orderId, state: 'awaiting_delivery_type' };
        await sendMessage(phoneNumber, '📦 ডেলিভারি টাইপ লিখুন:\n"text" অথবা "pdf"');
        return;
    }

    // ========== ৫. বাতিল ==========
    if (message.startsWith('!cancel')) {
        const parts = message.split(' ');
        if (parts.length < 3) {
            await sendMessage(phoneNumber, '⚠️ ফরম্যাট: !cancel ORDER_ID কারণ');
            return;
        }
        const orderId = parts[1];
        const reason = parts.slice(2).join(' ');
        await handleAdminCancel(phoneNumber, orderId, reason);
        return;
    }

    // ========== ৬. পরিসংখ্যান ==========
    if (message === '!stats') {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Orders!A:K'
        });
        const rows = response.data.values || [];
        let total = 0, pending = 0, delivered = 0, cancelled = 0, revenue = 0;
        rows.slice(1).forEach(row => {
            total++;
            if (row[6] === 'pending') pending++;
            else if (row[6] === 'delivered') { delivered++; revenue += parseInt(row[4]) || 0; }
            else if (row[6] === 'cancelled') cancelled++;
        });
        
        await sendMessage(phoneNumber, 
            `📊 পরিসংখ্যান\n\n📦 মোট: ${total}\n⏳ পেন্ডিং: ${pending}\n✅ সম্পন্ন: ${delivered}\n❌ বাতিল: ${cancelled}\n💰 আয়: ${revenue} টাকা`
        );
        return;
    }

    // ========== ৭. সব সার্ভিস ==========
    if (message === '!services') {
        const services = await loadServices();
        let text = '📋 সব সার্ভিস:\n\n';
        Object.keys(services).forEach(key => {
            const s = services[key];
            text += `🆔 ${key}\n📦 ${s.name}\n💰 ${s.price} টাকা\n⏱️ ${s.deliveryTime}\n\n`;
        });
        await sendMessage(phoneNumber, text);
        return;
    }

    // ========== ৮. সব অর্ডার ==========
    if (message === '!orders') {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Orders!A:K'
        });
        const rows = response.data.values || [];
        let text = '📋 সব অর্ডার:\n\n';
        rows.slice(1).forEach(row => {
            const statusEmoji = row[6] === 'pending' ? '⏳' : (row[6] === 'delivered' ? '✅' : '❌');
            text += `🆔 #${row[0]} | ${row[3]} | ${statusEmoji} ${row[6]}\n`;
        });
        await sendMessage(phoneNumber, text);
        return;
    }

    // ========== ৯. পেন্ডিং অর্ডার ==========
    if (message === '!pending') {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Orders!A:K'
        });
        const rows = response.data.values || [];
        const pending = rows.slice(1).filter(row => row[6] === 'pending');
        if (pending.length === 0) {
            await sendMessage(phoneNumber, '✅ কোনো পেন্ডিং অর্ডার নেই!');
            return;
        }
        let text = '⏳ পেন্ডিং অর্ডার:\n\n';
        pending.forEach(row => {
            text += `🆔 #${row[0]} | ${row[3]} | 💰${row[4]} টাকা\n`;
        });
        await sendMessage(phoneNumber, text);
        return;
    }

    // ========== ১০. হেল্প ==========
    if (message === '!help') {
        const helpText = `👑 অ্যাডমিন হেল্প\n\n` +
            `📌 সার্ভিস ম্যানেজমেন্ট:\n` +
            `!addservice ServiceID|নাম|দাম|সময়|ফিল্ড\n` +
            `!editservice ServiceID|নাম|দাম|সময়|ফিল্ড\n` +
            `!deleteservice ServiceID\n` +
            `!services\n\n` +
            `📦 অর্ডার ম্যানেজমেন্ট:\n` +
            `!deliver ORDER_ID\n` +
            `!cancel ORDER_ID কারণ\n` +
            `!orders\n` +
            `!pending\n` +
            `!stats\n\n` +
            `📌 উদাহরণ:\n` +
            `!addservice nid|NID কার্ড|180|১০-২০ মিনিট|name,nid,dob`;
        await sendMessage(phoneNumber, helpText);
        return;
    }
}

// ==================== ১৮. মেসেজ হ্যান্ডলার ====================
client.on('message', async message => {
    const phoneNumber = message.from.replace('@c.us', '');
    const text = message.body;

    // অ্যাডমিন কমান্ড
    if (text.startsWith('!') && await isAdmin(phoneNumber)) {
        await handleAdminCommand(phoneNumber, text);
        return;
    }

    // অ্যাডমিন ডেলিভারি টাইপ ইনপুট
    if (adminStates[phoneNumber] && adminStates[phoneNumber].state === 'awaiting_delivery_type') {
        const orderId = adminStates[phoneNumber].orderId;
        if (text.toLowerCase() === 'text' || text.toLowerCase() === 'pdf') {
            const type = text.toLowerCase();
            adminStates[phoneNumber].state = `awaiting_${type}`;
            await sendMessage(phoneNumber, `📝 ${type === 'text' ? 'টেক্সট' : 'PDF লিংক'} লিখুন:`);
        } else {
            await sendMessage(phoneNumber, '❌ ভুল! "text" বা "pdf" লিখুন।');
        }
        return;
    }

    if (adminStates[phoneNumber] && adminStates[phoneNumber].state === 'awaiting_text') {
        const orderId = adminStates[phoneNumber].orderId;
        await handleAdminDelivery(phoneNumber, orderId, 'text', text);
        return;
    }

    if (adminStates[phoneNumber] && adminStates[phoneNumber].state === 'awaiting_pdf') {
        const orderId = adminStates[phoneNumber].orderId;
        await handleAdminDelivery(phoneNumber, orderId, 'pdf', text);
        return;
    }

    // 👁️ বাটন ক্লিক হ্যান্ডল
    if (message.type === 'buttons_response' || message.type === 'button') {
        const buttonId = message.selectedButtonId || text;
        
        if (buttonId && buttonId.startsWith('view_order_')) {
            const orderId = buttonId.replace('view_order_', '');
            await sendOrderDetails(phoneNumber, orderId);
            return;
        }
        
        if (buttonId && buttonId.startsWith('service_')) {
            const serviceId = buttonId.replace('service_', '');
            await startOrderProcess(phoneNumber, serviceId);
            return;
        }
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

    // মেনু কমান্ড
    if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'start' || text.toLowerCase() === 'হ্যালো') {
        await sendServiceMenu(phoneNumber);
        return;
    }

    // সাধারণ ইউজার ইনপুট
    await handleUserInput(phoneNumber, text);
});

// ==================== ১৯. ওয়েবহুক এন্ডপয়েন্ট ====================
app.get('/', (req, res) => {
    res.send('🤖 WhatsApp বট লাইভ!');
});

app.get('/qr', (req, res) => {
    res.send('📱 QR Code স্ক্যান করুন। কনসোল দেখুন।');
});

// ==================== ২০. সার্ভার চালু ====================
client.initialize();

app.listen(PORT, () => {
    console.log(`🌐 ওয়েব সার্ভার চালু! পোর্ট: ${PORT}`);
});