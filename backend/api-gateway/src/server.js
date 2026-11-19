import app from './index.js';
const port = Number(process.env.API_GATEWAY_PORT || 4000);
app.listen(port, () => console.log(`API Gateway listening on ${port}`));