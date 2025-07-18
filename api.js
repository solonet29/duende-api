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

// --- RUTA DE BÚSQUEDA (CON LA MEJORA DE FECHAS) ---
app.get('/events', async (req, res) => {
    // 1. RECOGEMOS LOS NUEVOS FILTROS DE FECHA
    const { search, city, dateFrom, dateTo } = req.query; 
    
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        // 2. CONSTRUIMOS LA CONSULTA DINÁMICAMENTE
        let query = {};
        
        // El filtro base de fechas futuras se aplica solo si no se especifica un rango
        if (!dateFrom) {
            const todayString = new Date().toISOString().split('T')[0];
            query.date = { $gte: todayString };
        }

        if (search) {
            query.$text = { $search: search };
        }
        if (city) {
            query.city = city;
        }

        // 3. AÑADIMOS LAS CONDICIONES DEL RANGO DE FECHAS A LA CONSULTA
        if (dateFrom) {
            // Si query.date ya existe, le añadimos la condición $gte. Si no, lo creamos.
            query.date = { ...query.date, $gte: dateFrom };
        }
        if (dateTo) {
            query.date = { ...query.date, $lte: dateTo };
        }

        console.log("Ejecutando consulta avanzada:", JSON.stringify(query));
        const events = await eventsCollection.find(query).sort({ date: 1 }).toArray();
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