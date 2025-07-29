import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- CONFIGURACIÓN ---
const { MONGO_URI, GEMINI_API_KEY } = process.env;
if (!MONGO_URI) throw new Error('MONGO_URI no está definida.');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está definida.');

const app = express();
const mongoClient = new MongoClient(MONGO_URI);
let db;

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

// RUTA PRINCIPAL DE BÚSQUEDA DE EVENTOS
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
        if (search) {
            filter.$text = { $search: search };
        }

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

// RUTA PARA CONTAR EVENTOS
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

// RUTA PARA "PLANEAR NOCHE" CON GEMINI
app.post('/gemini', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'Falta el prompt en la petición' });
    }
    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        };
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!geminiResponse.ok) {
            console.error('Error desde la API de Gemini:', await geminiResponse.text());
            return res.status(geminiResponse.status).json({ error: 'Error al contactar la API de Gemini' });
        }
        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        res.status(200).json({ text: text });
    } catch (error) {
        console.error('Error interno del servidor en la ruta /gemini:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// RUTA PARA EL PLANIFICADOR DE VIAJES
app.post('/trip-planner', async (req, res) => {
    const { destination, startDate, endDate } = req.body;

    if (!destination || !startDate || !endDate) {
        return res.status(400).json({ error: 'Faltan datos para el plan de viaje.' });
    }

    try {
        const eventsCollection = db.collection("events");
        const filter = {
            city: { $regex: new RegExp(destination, 'i') },
            date: { $gte: startDate, $lte: endDate }
        };
        const events = await eventsCollection.find(filter).sort({ date: 1 }).toArray();

        if (events.length === 0) {
            return res.json({ text: "¡Qué pena! No se han encontrado eventos de flamenco para estas fechas y destino. Te sugiero probar con otro rango de fechas o explorar peñas flamencas y tablaos locales en la ciudad." });
        }

        const eventList = events.map(ev => `- ${new Date(ev.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })}: "${ev.name}" con ${ev.artist} en ${ev.venue}.`).join('\n');

        const tripPrompt = `Actúa como el mejor planificador de viajes de flamenco de Andalucía. Eres amigable, experto y apasionado. Un viajero quiere visitar ${destination} desde el ${startDate} hasta el ${endDate}. Su lista de espectáculos disponibles es:
${eventList}

Tu tarea es crear un itinerario detallado y profesional. Sigue ESTRICTAMENTE estas reglas:

1.  **Estructura por Días:** Organiza el plan día por día.
2.  **Títulos Temáticos:** Dale a cada día un título temático y evocador (ej. "Martes: Inmersión en el Sacromonte", "Miércoles: Noche de Cante Jondo").
3.  **Días con Eventos:** Haz que el espectáculo de la lista sea el punto culminante del día, sugiriendo actividades que lo complementen.
4.  **Días Libres:** Para los días sin espectáculos, ofrece dos alternativas claras: un "Plan A" (una actividad cultural principal como visitar un museo, un barrio emblemático o una tienda de guitarras) y un "Plan B" (una opción más relajada o diferente, como una clase de compás o un lugar con vistas para relajarse).
5.  **Glosario Final:** Al final de todo el itinerario, incluye una sección \`### Glosario Flamenco para el Viajero\` donde expliques brevemente 2-3 términos clave que hayas usado (ej. peña, tablao, duende, tercio).

Usa un tono inspirador y práctico. Sigue envolviendo los nombres de lugares recomendados entre corchetes [Nombre del Lugar].`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const payload = { contents: [{ role: "user", parts: [{ text: tripPrompt }] }] };
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            throw new Error('La IA no pudo generar el plan de viaje.');
        }

        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        res.status(200).json({ text: text });

    } catch (error) {
        console.error("Error en el planificador de viajes:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// Exporta la app para que Vercel la pueda usar
export default app;