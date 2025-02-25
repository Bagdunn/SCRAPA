const { MongoClient, ServerApiVersion } = require("mongodb");
const axios = require("axios");
const fs = require("fs");

// Завантажуємо конфіг (API ID, API HASH, сесію)
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const { api_id, api_hash, session } = config;

const uri = "mongodb+srv://ibodikolol2:Aa12Bb32O0%21@cluster0.9wiqt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function connectDB() {
    await client.connect();
    console.log("✅ Підключено до MongoDB!");
    return client.db("telegram_bot");
}

// Функція для отримання `file_path` через userbot API (Telethon / Pyrogram)
async function getFileUrl(fileId) {
    try {
        const response = await axios.post("https://my-userbot-api.com/getFile", { 
            session, 
            api_id, 
            api_hash, 
            file_id: fileId 
        });

        if (response.data && response.data.file_path) {
            return `https://api.telegram.org/file/bot<TOKEN>/${response.data.file_path}`; // Тут треба замінити <TOKEN> або зробити через userbot
        } else {
            console.error("❌ Помилка отримання file_path:", response.data);
            return null;
        }
    } catch (error) {
        console.error("❌ Запит до Telegram API не вдався:", error.message);
        return null;
    }
}

// Збереження поста з посиланням на фото
async function savePost(message) {
    const db = await connectDB();
    const posts = db.collection("posts");

    let mediaUrl = null;

    if (message.media && message.media.file_id) {
        mediaUrl = await getFileUrl(message.media.file_id);
    }

    const doc = {
        _id: message.id,
        channel: message.chatId.toString(),
        text: message.text || "",
        media: mediaUrl ? { type: "photo", url: mediaUrl } : null,
        timestamp: new Date(),
    };

    await posts.insertOne(doc);
    console.log("✅ Повідомлення збережено в MongoDB з посиланням на фото!");
}

module.exports = { connectDB, savePost };
