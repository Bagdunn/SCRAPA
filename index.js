const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const prompt = require("prompt-sync")();

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const apiId = config.api_id;
const apiHash = config.api_hash;
const forwardChatId = config.forward_chat_id;
const channelIds = new Set(config.channels.map(id => BigInt(id)));

let session = new StringSession("");
if (fs.existsSync("session.json")) {
    session = new StringSession(fs.readFileSync("session.json", "utf8"));
}

const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
});

(async () => {
    await client.start({
        phoneNumber: () => prompt("Введи номер телефону: "),
        password: () => prompt("Введи пароль (якщо є): "),
        phoneCode: () => prompt("Введи код з Telegram: "),
        onError: (err) => console.log(err),
    });

    console.log("✅ Бот підключений!");
    fs.writeFileSync("session.json", client.session.save());

    console.log("📡 Слухаємо канали...");

    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;
    
        console.log("📩 Отримано повідомлення!");
        console.log("🔹 Chat ID:", message.chatId);
        console.log("🔹 Повний об'єкт:", message.toJSON());
    });

    client.addEventHandler(async (update) => {
        if (update.className === "UpdateNewChannelMessage") {
            const message = update.message;
            const rawChannelId = message.peerId.channelId; // Отриманий ID без -100
            const formattedChannelId = BigInt(`-100${rawChannelId}`); // Додаємо -100
            
            console.log("rawID")
            console.log(rawChannelId)
            console.log("ID")
            console.log(formattedChannelId);

            console.log("------")
            console.log([...channelIds])

            if (channelIds.has(formattedChannelId)) {
                console.log(`📩 Нове повідомлення з каналу ${formattedChannelId}`);

                try {
                    const entity = await client.getInputEntity(forwardChatId);
                    await client.sendMessage(entity, {
                        message: message.message,
                        entities: message.entities,
                        media: message.media
                    });
                    console.log("✅ Повідомлення переслано!");
                } catch (err) {
                    console.log("❌ Помилка відправки:", err);
                }
            }
        }
    });
})();
