const path = require("path");
const fs = require("fs");

const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");

// Automatically scan all sub-pages that contain script.js
function getPageEntries() {
  const entries = {
    main: "./script.js",
  };

  fs.readdirSync(__dirname, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !["dist", "node_modules", "src", "public"].includes(d.name)
    )
    .forEach((d) => {
      const scriptPath = path.join(__dirname, d.name, "script.js");

      if (fs.existsSync(scriptPath)) {
        entries[d.name] = `./${d.name}/script.js`;
      }
    });

  return entries;
}

// Automatically create HtmlWebpackPlugin for sub-pages
function getPageHtmlPlugins() {
  const plugins = [];

  fs.readdirSync(__dirname, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !["dist", "node_modules", "src", "public"].includes(d.name)
    )
    .forEach((d) => {
      const htmlPath = path.join(__dirname, d.name, "index.html");
      const scriptPath = path.join(__dirname, d.name, "script.js");

      if (fs.existsSync(htmlPath) && fs.existsSync(scriptPath)) {
        plugins.push(
          new HtmlWebpackPlugin({
            template: `./${d.name}/index.html`,
            filename: `${d.name}/index.html`,
            chunks: [d.name],
            inject: "body",
          })
        );
      }
    });

  return plugins;
}

module.exports = (env, argv) => ({
  entry: getPageEntries(),

  // Generate source maps.
  // Change to false if you do not want source maps in production.
  devtool: "source-map",

  output: {
    path: path.resolve(__dirname, "dist"),

    filename: "[name].[contenthash:8].js",

    // Important for deployment under GitHub Pages.
    publicPath: "auto",

    clean: true,
  },

  resolve: {
    extensions: [".js", ".ts"],

    alias: {
      "@": __dirname,
    },
  },

  module: {
    rules: [
      // TypeScript
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: {
            configFile: path.resolve(__dirname, "tsconfig.json"),
          },
        },
      },

      // CSS
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },

      // Import HTML files under @tools as source strings
      {
        test: /\.html$/,
        include: /[\/\\]@tools[\/\\]/,
        type: "asset/source",
      },
    ],
  },

  optimization: {
    minimize: true,

    minimizer: [
      new TerserPlugin({
        extractComments: false,
      }),
    ],

    splitChunks: {
      chunks: "all",

      minSize: 100 * 1024,

      maxInitialRequests: 10,

      maxAsyncRequests: 20,

      cacheGroups: {
        monaco: {
          test: /[\/\\]node_modules[\/\\](?:\.pnpm[\/\\]monaco-editor@[^\/\\]+[\/\\]node_modules[\/\\])?monaco-editor[\/\\]/,

          name: "vendor-monaco",

          priority: 40,

          enforce: true,

          reuseExistingChunk: true,
        },

        react: {
          test: /[\/\\]node_modules[\/\\](?:react|react-dom|scheduler|react-complex-tree)[\/\\]/,

          name: "vendor-react",

          priority: 30,

          reuseExistingChunk: true,
        },

        vendors: {
          test: /[\/\\]node_modules[\/\\]/,

          name: "vendors",

          priority: 20,

          reuseExistingChunk: true,
        },

        common: {
          name: "common",

          minChunks: 3,

          minSize: 120 * 1024,

          priority: 10,

          reuseExistingChunk: true,
        },
      },
    },
  },

  plugins: [
    // Monaco Editor
    new MonacoWebpackPlugin({
      languages: ["cpp"],

      monacoEditorPath: path.dirname(
        require.resolve("monaco-editor/package.json")
      ),
    }),

    // Main page
    new HtmlWebpackPlugin({
      template: "./index.html",
      filename: "index.html",
      inject: "body",
      chunks: ["main"],
    }),

    // Automatically generated sub-pages
    ...getPageHtmlPlugins(),

    // Extract CSS
    new MiniCssExtractPlugin({
      filename: "style.[contenthash:8].css",
    }),

    // Copy static files.
    //
    // Do NOT copy files that Webpack already processes.
    new CopyWebpackPlugin({
      patterns: [
        {
          from: ".",
          globOptions: {
            ignore: [
              "**/dist/**",
              "**/node_modules/**",
              "**/.github/**",
              // Build/config files
              "**/webpack.config.js",
              "**/package.json",
              "**/pnpm-lock.yaml",
              "**/tsconfig.json",

              // Files processed by Webpack / HtmlWebpackPlugin
              "**/index.html",
              "**/script.js",
              "**/style.css",
              "**/*.ts",
            ],
          },
        },
      ],
    }),
  ],

  mode: argv?.mode || "production",
});
