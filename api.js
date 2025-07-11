import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// Configuración
const { MONGO_URI, PORT } = process.env;
const app = express();
const port = PORT || 3001;
const mongoClient = new MongoClient(MONGO_URI);

// Configuración de CORS para permitir solo peticiones desde tu frontend
const corsOptions = {
  origin: 'https://duende-frontend.vercel.app' 
};

app.use(cors(corsOptions));
app.use(express.json());

// El endpoint que el usuario consultará
app.get('/events', async (req, res) => {
    const { search } = req.query; // Obtiene el texto de búsqueda, ej: /events?search=madrid
    console.log(`Búsqueda recibida: "${search}"`);

    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        let query = {};
        if (search) {
            // Crea una búsqueda "full-text" sobre los campos importantes.
            // Necesitarás crear un "índice de texto" en MongoDB Atlas para que funcione bien.
            query = { $text: { $search: search } };
        }

        const events = await eventsCollection.find(query).toArray();
        res.json(events);
    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    } finally {
        await mongoClient.close();
    }
});

app.listen(port, () => {
    console.log(`API de Duende Finder escuchando en http://localhost:${port}`);
});
