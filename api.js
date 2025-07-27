import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- CONFIGURACIÓN (Sin cambios) ---
const { MONGO_URI, PORT } = process.env;
const app = express();
const port = PORT || 3001;
const mongoClient = new MongoClient(MONGO_URI);

const allowedOrigins = ['https://duende-frontend.vercel.app', 'https://buscador.afland.es'];
const corsOptions = { /* ...código de CORS sin cambios... */ };
app.use(cors(corsOptions));
app.use(express.json());

async function startServer() { /* ...código de startServer sin cambios... */ }

// --- RUTA DE BÚSQUEDA (CORREGIDA Y MEJORADA) ---
app.get('/events', async (req, res) => {
    const { search, artist, city, dateFrom, dateTo } = req.query;
    
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        const todayString = new Date().toISOString().split('T')[0];
        
        // 1. CONSTRUIMOS UN OBJETO DE FILTROS SEGURO
        // Empezamos con el filtro base que solo busca eventos futuros
        let filter = { date: { $gte: todayString } };

        // 2. AÑADIMOS LOS FILTROS DE FORMA DINÁMICA
        if (city) {
            // Usamos una expresión regular para que la búsqueda de ciudad no distinga mayúsculas/minúsculas
            filter.city = { $regex: new RegExp(`^${city}$`, 'i') };
        }
        if (artist) {
            // Igual para el artista
            filter.artist = { $regex: new RegExp(artist, 'i') };
        }
        if (dateFrom) {
            filter.date.$gte = dateFrom;
        }
        if (dateTo) {
            filter.date.$lte = dateTo;
        }
        
        // El filtro de texto general ($text) es especial y no puede combinarse
        // con otros filtros de texto como los de arriba. Le damos prioridad.
        if (search) {
             console.log(`Búsqueda de texto general recibida: "${search}"`);
             filter = { $text: { $search: search } };
        }

        console.log("Ejecutando consulta avanzada:", JSON.stringify(filter));
        const events = await eventsCollection.find(filter).sort({ date: 1 }).toArray();
        res.json(events);

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    } finally {
        await mongoClient.close();
    }
});

// La ruta /events/count y el resto del archivo no cambian
// ...

startServer();