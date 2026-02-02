import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { api } from "../lib/api";
import { OCRSelector } from "./components/OCRSelector";
import "./global.css";

/**
 * Main Comic Reader App component
 */
function App() {
  const [message, setMessage] = useState("");
  const [comics, setComics] = useState<
    Array<{ id: number; title: string; pages: number }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch hello message and comics using type-safe Eden Treaty
    Promise.all([api.api.hello.get(), api.api.comics.get()]).then(
      ([helloRes, comicsRes]) => {
        if (helloRes.data) {
          setMessage(helloRes.data.message);
        }
        if (comicsRes.data) {
          setComics(comicsRes.data.comics);
        }
        setLoading(false);
      },
    );
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-800 mb-4">
            📚 Comic Reader
          </h1>
          <p className="text-xl text-gray-600">{message || "Loading..."}</p>
        </header>

        {loading ? (
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <>
            {/* Comic Page Display with OCR */}
            <div className="mb-12 bg-white rounded-lg shadow-xl p-8">
              <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">
                📖 Sample Comic Page with OCR
              </h2>
              <OCRSelector imageUrl="/uploads/57_005.png" />
            </div>

            {/* Comic List */}
            <h2 className="text-3xl font-bold text-gray-800 mb-6">
              Available Comics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {comics.map((comic) => (
                <div
                  key={comic.id}
                  className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow"
                >
                  <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                    {comic.title}
                  </h3>
                  <p className="text-gray-600">Pages: {comic.pages}</p>
                  <button className="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded transition-colors">
                    Read Now
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <footer className="mt-12 text-center text-gray-500">
          <p>Built with Bun + Elysia + React + Tailwind CSS</p>
        </footer>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
