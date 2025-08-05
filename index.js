import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({
  origin: ['https://buscador.afland.es', 'https://duende-frontend.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- RUTAS DE LA API ---

app.get('/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({ version: "17.0-ultra-simple" });
});

app.get('/events/count', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    // Devolvemos un número fijo para la prueba
    res.json({ total: 123 }); 
});

app.get('/events', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    console.log(`\n--- [INICIO v17] Petición a /events ---`);
    console.log(`Query Params recibidos: ${JSON.stringify(req.query)}`);
    const { search } = req.query;

    if (search) {
        console.log(`-> PARAMETRO 'search' RECIBIDO: "${search}"`);
        // Si hay búsqueda, devolvemos un único evento de prueba que lo confirma
        res.json([
            { name: `Búsqueda exitosa para: ${search}`, artist: "El Depurador", date: "2025-08-05" }
        ]);
    } else {
        console.log(`-> SIN PARAMETRO 'search'. Devolviendo lista por defecto.`);
        // Si no hay búsqueda, devolvemos una lista por defecto
        res.json([
            { name: "Evento por defecto 1", artist: "API de Vercel", date: "2025-08-05" },
            { name: "Evento por defecto 2", artist: "API de Vercel", date: "2025-08-06" }
        ]);
    }
    console.log(`--- [FIN v17] Petición a /events ---`);
});


// Exporta la app para que Vercel la pueda usar
export default app;