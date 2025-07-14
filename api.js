import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// Configuración
const { MONGO_URI, PORT } = process.env;
const app = express();
const port = PORT || 3001;
const mongoClient = new MongoClient(MONGO_URI);

// --- ¡AQUÍ ESTÁ LA MEJORA! ---
// 1. Creamos una lista con todos los dominios que tienen permiso.
const allowedOrigins = [
  'https://duende-frontend.vercel.app',
  'https://buscador.afland.es'
];

// 2. Configuramos CORS para que use esa lista.
const corsOptions = {
  origin: function (origin, callback) {
    // Permite peticiones sin origen (como las de Postman o apps móviles)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'La política de CORS para este sitio no permite el acceso desde el origen especificado.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
};

// 3. Usamos la nueva configuración.
app.use(cors(corsOptions));
// --- FIN DE LA MEJORA ---


app.use(express.json());

app.get('/events', async (req, res) => {
    const { search } = req.query; 
    console.log(`Búsqueda recibida: "${search}"`);

    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        let query = {};
        if (search) {
            query = { $text: { $search: search } };
        }

        const events = await eventsCollection.find(query).sort({ date: 1 }).toArray();
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