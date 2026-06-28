// ==================== আমাদার সেবা WhatsApp বট ====================
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

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

// ==================== সার্ভিস লিস্ট ====================
const SERVICES = {
    nid: { name: 'NID কার্ড', price: 180, time: '১০-২০ মিনিট', fields: ['নাম', 'NID নম্বর', 'জন্ম তারিখ'] },
    lost_id: { name: 'হারানো আইডি কার্ড', price: 1200, time: '১-২ ঘন্টা', fields: ['নাম', 'পিতার নাম', 'মাতার নাম', 'ঠিকানা'] },
    double_voter: { name: 'ডাবল ভোটার', price: 3500, time: '২-৩ ঘন্টা', fields: ['প্রথম ঠিকানা', 'দ্বিতীয় ঠিকানা'] }
};

// ==================== স্টেট ====================
const userStates = {};

// ==================== মেসেজ পাঠান ====================
async function sendMessage(to, text) {
    try {
        await client.sendMessage(to, text);
        return true;
    } catch (error) {
        console.log('❌ মেসেজ পাঠাতে ব্যর্থ:', error.message);
        return false;
    }
}

// ==================== মেনু ====================
async function sendMenu(phoneNumber) {
    let text = '👋 *স্বাগতম! আমাদের সার্ভিস:*\n\n';
    Object.keys(SERVICES).forEach((key, i) => {
        const s = SERVICES[key];
        text += `${i+1}. ${s.name} - ${s.price} টাকা\n`;
    });
    text += '\n📌 সার্ভিসের নাম লিখুন (যেমন: nid)';
    await sendMessage(phoneNumber, text);
}

// ==================== অর্ডার প্রসেস ====================
async function startOrder(phoneNumber, serviceId) {
    const service = SERVICES[serviceId];
    if (!service) {
        await sendMessage(phoneNumber, '❌ সার্ভিস খুঁজে পাওয়া যায়নি।');
        return;
    }

    userStates[phoneNumber] = {
        service: service,
        fields: service.fields,
        index: 0,
        data: {}
    };

    await sendMessage(phoneNumber, `✅ ${service.name} সিলেক্ট করেছেন!\n💰 দাম: ${service.price} টাকা\n⏱️ সময়: ${service.time}\n\n📝 ${service.fields[0]} দিন:`);
}

// ==================== মেসেজ হ্যান্ডলার ====================
client.on('message', async message => {
    const from = message.from;
    const text = message.body.trim();
    const phone = from.replace('@c.us', '');

    console.log(`📩 ${phone}: ${text}`);

    // মেনু
    if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'start' || text === 'হ্যালো') {
        await sendMenu(from);
        return;
    }

    // সার্ভিস সিলেক্ট
    if (SERVICES[text]) {
        await startOrder(from, text);
        return;
    }

    // ইউজার ইনপুট
    const state = userStates[phone];
    if (state) {
        state.data[state.fields[state.index]] = text;
        state.index++;

        if (state.index >= state.fields.length) {
            // সব তথ্য নেওয়া হয়েছে
            const orderId = Math.floor(100000 + Math.random() * 900000);
            let info = '📋 *অর্ডার তথ্য:*\n';
            Object.keys(state.data).forEach(key => {
                info += `• ${key}: ${state.data[key]}\n`;
            });

            await sendMessage(from, `✅ *অর্ডার সফল!*\n\n🆔 অর্ডার আইডি: #${orderId}\n📦 সার্ভিস: ${state.service.name}\n💰 দাম: ${state.service.price} টাকা\n📊 স্ট্যাটাস: ⏳ পেন্ডিং\n\n${info}\n\nআমরা শীঘ্রই ডেলিভারি দেব।`);
            
            // অ্যাডমিন নোটিফিকেশন (যদি ADMIN_PHONE সেট করা থাকে)
            if (process.env.ADMIN_PHONE) {
                await sendMessage(`${process.env.ADMIN_PHONE}@c.us`, `🛒 নতুন অর্ডার!\n🆔 #${orderId}\n👤 ${phone}\n📦 ${state.service.name}\n💰 ${state.service.price} টাকা`);
            }

            delete userStates[phone];
        } else {
            await sendMessage(from, `📝 ${state.fields[state.index]} দিন:`);
        }
        return;
    }

    // কিছু না বুঝলে
    await sendMessage(from, '❌ বুঝতে পারিনি। "menu" লিখে সার্ভিস দেখুন।');
});

// ==================== ওয়েব সার্ভার ====================
app.get('/', (req, res) => {
    res.send('🤖 আমাদার সেবা বট লাইভ!');
});

app.get('/qr', (req, res) => {
    res.send('📱 QR Code দেখতে কনসোল চেক করুন।');
});

// ==================== চালু করুন ====================
client.initialize();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 সার্ভার চালু! পোর্ট: ${PORT}`);
    console.log('📱 QR কোড জেনারেট হচ্ছে...');
});
