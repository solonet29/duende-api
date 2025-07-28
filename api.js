import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- CONFIGURACIÓN ---
const { MONGO_URI, PORT } = process.env;
if (!MONGO_URI) {
    throw new Error('La variable de entorno MONGO_URI no está definida.');
}
const app = express();
const port = PORT || 3001;

// --- CLIENTE DE MONGODB ---
const mongoClient = new MongoClient(MONGO_URI);
let db;

// --- MIDDLEWARE ---
const allowedOrigins = [
    'https://duende-frontend.vercel.app', 
    'https://buscador.afland.es',
    'http://localhost:3000'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());

// --- RUTAS DE LA API ---

// RUTA PRINCIPAL DE BÚSQUEDA DE EVENTOS (REFINADA)
app.get('/events', async (req, res) => {
    const { search, artist, city, country, dateFrom, dateTo, timeframe } = req.query;
    
    try {
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Objeto para el filtro principal ($match)
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

        // MEJORA 1: Usamos el índice de texto para la búsqueda general.
        if (search) {
            filter.$text = { $search: search };
        }

        // MEJORA 2: Pipeline de Agregación para ordenar y eliminar duplicados.
        const aggregationPipeline = [
            // Etapa 1: Filtrar documentos con los criterios de búsqueda.
            { $match: filter },
            // Etapa 2: Ordenar para priorizar los mejores resultados antes de agrupar.
            { 
                $sort: {
                    date: 1,      // Ordenar por fecha ascendente
                    verified: -1, // Priorizar verificados (true antes que false)
                    sourceURL: -1  // Priorizar los que tienen URL de fuente
                }
            },
            // Etapa 3: Agrupar para eliminar duplicados.
            {
                $group: {
                    // Agrupar por los campos que definen un evento único
                    _id: { 
                        artist: "$artist",
                        date: "$date",
                        time: "$time"
                    },
                    // Usamos $first para quedarnos con el primer documento de cada grupo,
                    // que será el "mejor" gracias al $sort anterior.
                    doc: { $first: "$$ROOT" }
                }
            },
            // Etapa 4: Devolver solo el documento original sin la estructura de agrupación.
            { $replaceRoot: { newRoot: "$doc" } },
            // Etapa 5: Ordenar el resultado final de nuevo por fecha.
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


// --- FUNCIÓN PARA INICIAR EL SERVIDOR ---
async function startServer() {
    try {
        await mongoClient.connect();
        console.log("Conectado a MongoDB correctamente.");
        db = mongoClient.db("DuendeDB");

        app.listen(port, () => {
            console.log(`Servidor escuchando en http://localhost:${port}`);
        });
    } catch (error) {
        console.error("No se pudo conectar a MongoDB o iniciar el servidor:", error);
        process.exit(1);
    }
}

// --- INICIO ---
startServer();