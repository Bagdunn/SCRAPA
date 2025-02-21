const { MongoClient, GridFSBucket, ServerApiVersion } = require("mongodb");
const fs = require("fs");

const uri = "";
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

async function savePost(message) {
    const db = await connectDB();
    const posts = db.collection("posts");

    const doc = {
        _id: message.id,
        channel: message.chatId.toString(),
        text: message.text || "",
        media: message.media ? { type: "photo", file_id: message.media.file_id } : null,
        timestamp: new Date(),
    };

    await posts.insertOne(doc);
    console.log("✅ Повідомлення збережено в MongoDB!");
}

async function savePhotoToDB(filePath, fileName) {
    const db = await connectDB();
    const bucket = new GridFSBucket(db, { bucketName: "photos" });

    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(bucket.openUploadStream(fileName))
            .on("finish", (file) => {
                console.log("✅ Фото збережено в MongoDB!");
                resolve(file._id);
            })
            .on("error", reject);
    });
}

module.exports = { connectDB, savePost, savePhotoToDB };
