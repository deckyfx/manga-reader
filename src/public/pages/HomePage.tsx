import { Link } from "react-router-dom";

/**
 * Home page component
 */
export function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-800 mb-4">
            📚 Comic Reader
          </h1>
          <p className="text-xl text-gray-600">
            Read and translate manga with OCR
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Reader Section */}
          <Link
            to="/r"
            className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow"
          >
            <div className="text-center">
              <div className="text-6xl mb-4">📖</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                Browse Series
              </h2>
              <p className="text-gray-600">
                Read manga with inline OCR and translations
              </p>
            </div>
          </Link>

          {/* Admin Section */}
          <Link
            to="/a/create"
            className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow"
          >
            <div className="text-center">
              <div className="text-6xl mb-4">⚙️</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                Admin Panel
              </h2>
              <p className="text-gray-600">
                Upload and manage manga series
              </p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
