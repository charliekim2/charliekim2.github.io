const express = require("express");
const path = require("path");

const app = express();

app.use(express.static("static"));
app.use(express.static("."));

app.get("/:page", (req, res) => {
  res.sendFile(`${req.params.page}.html`, { root: path.join(__dirname) });
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
