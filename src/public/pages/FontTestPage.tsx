import { Link } from "react-router-dom";

/**
 * Font Test page - Test Nunito, Anime Ace, and Font Awesome fonts
 */
export function FontTestPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-4xl font-bold text-gray-800">Font Test</h1>
          <Link
            to="/"
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            ← Back to Home
          </Link>
        </div>

        {/* Nunito Font Test (Default UI Font) */}
        <section className="mb-12 bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Nunito Font (Dashboard Default)
          </h2>

          <div className="space-y-6">
            {/* Different Weights */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-4">
                Font Weights (Variable Font: 200-900)
              </h3>
              <div className="space-y-2">
                <p className="text-xl" style={{ fontWeight: 200 }}>
                  Extra Light (200) - The quick brown fox jumps over the lazy dog
                </p>
                <p className="text-xl" style={{ fontWeight: 300 }}>
                  Light (300) - The quick brown fox jumps over the lazy dog
                </p>
                <p className="text-xl" style={{ fontWeight: 400 }}>
                  Regular (400) - The quick brown fox jumps over the lazy dog
                </p>
                <p className="text-xl" style={{ fontWeight: 600 }}>
                  Semi Bold (600) - The quick brown fox jumps over the lazy dog
                </p>
                <p className="text-xl" style={{ fontWeight: 700 }}>
                  Bold (700) - The quick brown fox jumps over the lazy dog
                </p>
                <p className="text-xl" style={{ fontWeight: 800 }}>
                  Extra Bold (800) - The quick brown fox jumps over the lazy dog
                </p>
                <p className="text-xl" style={{ fontWeight: 900 }}>
                  Black (900) - The quick brown fox jumps over the lazy dog
                </p>
              </div>
            </div>

            {/* Italic */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-4">
                Italic Variants
              </h3>
              <div className="space-y-2">
                <p className="text-xl italic" style={{ fontWeight: 400 }}>
                  Regular Italic - The quick brown fox jumps over the lazy dog
                </p>
                <p className="text-xl italic" style={{ fontWeight: 700 }}>
                  Bold Italic - The quick brown fox jumps over the lazy dog
                </p>
              </div>
            </div>

            {/* UI Sample */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-4">
                Dashboard UI Sample
              </h3>
              <div className="p-6 bg-gray-50 rounded-lg border border-gray-200">
                <h4 className="text-2xl font-bold mb-2">Manga Series Title</h4>
                <p className="text-base text-gray-600 mb-4">
                  A wonderful manga about adventure, friendship, and courage.
                  This font provides excellent readability for dashboard interfaces.
                </p>
                <div className="flex gap-2">
                  <button className="px-4 py-2 bg-blue-500 text-white rounded font-semibold hover:bg-blue-600">
                    Read Now
                  </button>
                  <button className="px-4 py-2 bg-gray-200 text-gray-700 rounded font-semibold hover:bg-gray-300">
                    Add to Library
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Anime Ace Font Test */}
        <section className="mb-12 bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Anime Ace Font
          </h2>

          <div className="space-y-6">
            {/* Regular */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                Regular
              </h3>
              <p
                className="text-2xl p-4 bg-gray-50 rounded border border-gray-200"
                style={{ fontFamily: "Anime Ace, sans-serif" }}
              >
                The quick brown fox jumps over the lazy dog
              </p>
              <p
                className="text-base p-4 bg-gray-50 rounded border border-gray-200 mt-2"
                style={{ fontFamily: "Anime Ace, sans-serif" }}
              >
                あいうえお カタカナ 漢字テスト Manga Reader Application
              </p>
            </div>

            {/* Bold */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Bold</h3>
              <p
                className="text-2xl p-4 bg-gray-50 rounded border border-gray-200"
                style={{ fontFamily: "Anime Ace Bold, sans-serif" }}
              >
                The quick brown fox jumps over the lazy dog
              </p>
            </div>

            {/* Italic */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                Italic
              </h3>
              <p
                className="text-2xl p-4 bg-gray-50 rounded border border-gray-200"
                style={{ fontFamily: "Anime Ace Italic, sans-serif" }}
              >
                The quick brown fox jumps over the lazy dog
              </p>
            </div>

            {/* Sample manga dialog */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                Manga Dialog Sample
              </h3>
              <div className="p-6 bg-gradient-to-br from-yellow-100 to-orange-100 rounded-lg border-2 border-gray-800 relative">
                <p
                  className="text-xl text-center font-bold"
                  style={{ fontFamily: "Anime Ace Bold, sans-serif" }}
                >
                  WHAT?! YOU CAN'T BE SERIOUS!
                </p>
                <p
                  className="text-lg text-center mt-2"
                  style={{ fontFamily: "Anime Ace, sans-serif" }}
                >
                  This is impossible...
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Font Awesome Icons Test */}
        <section className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Font Awesome Icons
          </h2>

          <div className="space-y-6">
            {/* Solid Icons */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-4">
                Solid Icons (fa-solid-900)
              </h3>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-4 p-4 bg-gray-50 rounded border border-gray-200">
                <div className="text-center">
                  <i className="fas fa-home text-3xl text-blue-500"></i>
                  <p className="text-xs mt-1">home</p>
                </div>
                <div className="text-center">
                  <i className="fas fa-book text-3xl text-green-500"></i>
                  <p className="text-xs mt-1">book</p>
                </div>
                <div className="text-center">
                  <i className="fas fa-search text-3xl text-purple-500"></i>
                  <p className="text-xs mt-1">search</p>
                </div>
                <div className="text-center">
                  <i className="fas fa-cog text-3xl text-gray-500"></i>
                  <p className="text-xs mt-1">cog</p>
                </div>
                <div className="text-center">
                  <i className="fas fa-arrow-left text-3xl text-red-500"></i>
                  <p className="text-xs mt-1">arrow-left</p>
                </div>
                <div className="text-center">
                  <i className="fas fa-arrow-right text-3xl text-red-500"></i>
                  <p className="text-xs mt-1">arrow-right</p>
                </div>
                <div className="text-center">
                  <i className="fas fa-heart text-3xl text-pink-500"></i>
                  <p className="text-xs mt-1">heart</p>
                </div>
                <div className="text-center">
                  <i className="fas fa-star text-3xl text-yellow-500"></i>
                  <p className="text-xs mt-1">star</p>
                </div>
              </div>
            </div>

            {/* Regular Icons */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-4">
                Regular Icons (fa-regular-400)
              </h3>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-4 p-4 bg-gray-50 rounded border border-gray-200">
                <div className="text-center">
                  <i className="far fa-heart text-3xl text-pink-500"></i>
                  <p className="text-xs mt-1">heart</p>
                </div>
                <div className="text-center">
                  <i className="far fa-star text-3xl text-yellow-500"></i>
                  <p className="text-xs mt-1">star</p>
                </div>
                <div className="text-center">
                  <i className="far fa-bookmark text-3xl text-blue-500"></i>
                  <p className="text-xs mt-1">bookmark</p>
                </div>
                <div className="text-center">
                  <i className="far fa-circle text-3xl text-green-500"></i>
                  <p className="text-xs mt-1">circle</p>
                </div>
              </div>
            </div>

            {/* Usage Example */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-4">
                Usage Example
              </h3>
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded border border-gray-200">
                <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2">
                  <i className="fas fa-book"></i>
                  <span>Read Manga</span>
                </button>
                <button className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-2">
                  <i className="fas fa-upload"></i>
                  <span>Upload</span>
                </button>
                <button className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-2">
                  <i className="fas fa-trash"></i>
                  <span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Font Loading Instructions */}
        <section className="mt-8 bg-blue-50 rounded-lg p-6 border border-blue-200">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            ℹ️ Font Loading Status
          </h3>
          <p className="text-blue-800">
            If fonts are not displaying correctly, ensure font files are loaded
            in <code className="bg-blue-100 px-2 py-1 rounded">global.css</code>
          </p>
        </section>
      </div>
    </div>
  );
}
