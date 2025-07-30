// Contenido corregido para database.js
import { MongoClient } from 'mongodb';

// Tomaremos la URL de conexión de las variables de entorno de Render
const uri = process.env.MONGODB_URI; 

if (!uri) {
    throw new Error('La variable de entorno MONGODB_URI no está definida.');
}

const client = new MongoClient(uri);

async function connectDB() {
    try {
        await client.connect();
        console.log("Conectado exitosamente a la base de datos MongoDB");
        // Devuelve el cliente para que podamos usarlo en otras partes
        return client;
    } catch (e) {
        console.error("No se pudo conectar a MongoDB", e);
        process.exit(1); 
    }
}

// Usamos 'export' en lugar de 'module.exports'
export { connectDB, client };