// index.js - VERSIÓN FINAL CON TODAS LAS MEJORAS

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURACIÓN ---
const { MONGO_URI, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!MONGO_URI) throw new Error('MONGO_URI no está definida.');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está definida.');

const app = express();
const mongoClient = new MongoClient(MONGO_URI);
let db;

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
if (!supabase) {
    console.warn("Supabase analytics is disabled. Environment variables are not set.");
}

// Conectar a la base de datos una sola vez al inicio
await mongoClient.connect();
db = mongoClient.db("DuendeDB");
console.log("Conectado a MongoDB.");

// --- MIDDLEWARE ---
const allowedOrigins = [
    'https://duende-frontend.vercel.app', 
    'https://buscador.afland.es',
    'http://localhost:3000'
];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// --- RUTAS DE LA API ---

// RUTA PRINCIPAL DE BÚSQUEDA DE EVENTOS (CON LÓGICA MEJORADA)
app.get('/events', async (req, res) => {
    const { search, artist, city, country, dateFrom, dateTo, timeframe } = req.query;
    
    try {
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const filter = {
            date: { $gte: today.toISOString().split('T')[0] }
        };

        if (city) {
            const cityRegex = new RegExp(city, 'i');
            filter.$or = [ { city: cityRegex }, { provincia: cityRegex } ];
        }
        if (country) {
            filter.country = { $regex: new RegExp(`^${country}$`, 'i') };
        }
        if (artist) {
            filter.artist = { $regex: new RegExp(artist, 'i') };
        }
        if (dateFrom) {
            filter.date.$gte = dateFrom;
        }
        if (dateTo) {
            filter.date.$lte = dateTo;
        }
        if (timeframe === 'week' && !dateTo) {
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);
            filter.date.$lte = nextWeek.toISOString().split('T')[0];
        }

        // ---- BLOQUE DE BÚSQUEDA CORREGIDO ----
        if (search) {
            const searchTerms = search.split(' ').map(term => `"${term}"`).join(' ');
            filter.$text = { 
                $search: searchTerms,
                $language: 'spanish'
            };
        }
        // ------------------------------------

        const aggregationPipeline = [
            { $match: filter },
            { $sort: { date: 1, verified: -1, sourceURL: -1 } },
            {
                $group: {
                    _id: { artist: "$artist", date: "$date", time: "$time" },
                    doc: { $first: "$$ROOT" }
                }
            },
            { $replaceRoot: { newRoot: "$doc" } },
            { $sort: { date: 1 } }
        ];
        
        const events = await eventsCollection.aggregate(aggregationPipeline).toArray();
        res.json(events);

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// --- OTRAS RUTAS (SIN CAMBIOS) ---
app.get('/events/count', async (req, res) => {
    try {
        const eventsCollection = db.collection("events");
        const todayString = new Date().toISOString().split('T')[0];
        const count = await eventsCollection.countDocuments({ date: { $gte: todayString } });
        res.json({ total: count });
    } catch (error) {
        console.error("Error al contar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

app.post('/gemini', async (req, res) => {
    // Tu código para Gemini va aquí...
});

app.post('/trip-planner', async (req, res) => {
    // Tu código para el planificador de viajes va aquí...
});


// --- RUTAS DE ANALÍTICAS ---

// RUTA PARA REGISTRAR EVENTOS DE BÚSQUEDA
app.post('/log-search', async (req, res) => {
    if (!supabase) return res.status(200).json({ message: 'Analytics disabled.' });

    try {
        const { searchTerm, filtersApplied, resultsCount, sessionId, geo } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

        await supabase.from('search_events').insert([{ 
            search_term: searchTerm, 
            filters_applied: filtersApplied,
            results_count: resultsCount,
            session_id: sessionId,
            geo: geo,
            interaction_type: 'search'
        }]);
        
        return res.status(201).json({ success: true });
    } catch (e) {
        console.error('Log search error:', e.message);
        return res.status(200).json({ success: false });
    }
});

// --- NUEVA RUTA PARA REGISTRAR CLICS EN BOTONES ---
app.post('/log-interaction', async (req, res) => {
    if (!supabase) return res.status(200).json({ message: 'Analytics disabled' });

    try {
        const { interaction_type, session_id, event_details } = req.body;
        if (!interaction_type || !session_id) {
            return res.status(400).json({ error: 'interaction_type and session_id are required' });
        }

        // Guardamos la interacción en la base de datos de Supabase.
        // Usamos la columna 'filters_applied' para guardar el contexto del evento.
        const { error } = await supabase.from('search_events').insert([{
            session_id: session_id,
            interaction_type: interaction_type,
            filters_applied: event_details // Guardamos los detalles del evento aquí para tener contexto
        }]);

        if (error) throw error;

        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Error logging interaction:', error);
        res.status(200).json({ success: false, message: error.message });
    }
});
// ----------------------------------------------------


// Exporta la app para que Vercel la pueda usar
export default app;