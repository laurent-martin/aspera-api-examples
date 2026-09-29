package utils;

import java.util.Map;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.Locale;
import java.util.regex.Pattern;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import org.json.JSONArray;
import org.json.JSONObject;
import org.yaml.snakeyaml.Yaml;

/**
 * Configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.
 */
public class Configuration {
    private static final Logger LOGGER = Logger.getLogger(Configuration.class.getName());
    private static final String PATHS_FILES = "config/paths.yaml";
    private static final String DIR_TOP_PROPERTY = "dir_top";
    // secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters
    private static final Pattern SECRETS_REGEX = Pattern.compile(
            "(\"[^\"]*(?:assertion|authorization|password|private_key|secret|token)\"\\s*:\\s*\")[^\"]+|(assertion=)[^&]+");
    // set from configuration file (misc.show_secrets)
    private static boolean showSecrets = false;

    // config filer loaded from yaml
    private final String[] fileList;
    private final String topFolder;
    private final String logFolder;
    private final Map<String, String> paths;
    private Map<String, Map<String, Object>> config;

    /**
     * Read the configuration file, and set up logging.
     *
     * @param args command line arguments: files to transfer
     */
    public Configuration(String[] args) {
        fileList = args;
        Locale.setDefault(Locale.ENGLISH);
        try {
            topFolder = findTopFolder();
            logFolder = System.getProperty("java.io.tmpdir");
            final String paths_config_file = getPath(null);
            paths = new Yaml().load(new java.io.FileReader(paths_config_file));
            final String config_filepath = getPath("main_config");
            config = new Yaml().load(new java.io.FileReader(config_filepath));
        } catch (final java.io.FileNotFoundException e) {
            throw new Error(e.getMessage());
        }
        setLogLevel(getParamStr("misc", "level"));
        final var misc = config.get("misc");
        showSecrets = misc != null && Boolean.TRUE.equals(misc.get("show_secrets"));
    }

    /**
     * Hide secrets in text for logs, unless configured to show them.
     *
     * @param text text that may contain secrets
     * @return text with hidden secrets
     */
    public static String maskSecrets(final String text) {
        if (showSecrets) {
            return text;
        }
        return SECRETS_REGEX.matcher(text).replaceAll("$1$2***");
    }

    /**
     * Log a named value at debug level: objects are displayed in JSON, and secrets are hidden.
     *
     * @param name name of the value
     * @param value value to log: a string, or an object displayed in JSON
     */
    public static void logDump(final String name, final Object value) {
        logDump(name, value, Level.FINE);
    }

    /**
     * Log a named value: objects are displayed in JSON, and secrets are hidden.
     *
     * @param name name of the value
     * @param value value to log: a string, or an object displayed in JSON
     * @param level log level
     */
    public static void logDump(final String name, final Object value, final Level level) {
        if (!LOGGER.isLoggable(level)) {
            return;
        }
        final String text = value instanceof String ? (String) value : String.valueOf(JSONObject.wrap(value));
        LOGGER.log(level, "{0}: {1}", new Object[] {name, maskSecrets(text)});
    }

    /**
     * Set the log level of the root logger and its handlers.
     *
     * @param levelName {@code debug}, {@code info}, {@code warning} or {@code error}
     */
    private static void setLogLevel(final String levelName) {
        final Level level = switch (levelName) {
            case "debug" -> Level.FINE;
            case "info" -> Level.INFO;
            case "warning" -> Level.WARNING;
            case "error" -> Level.SEVERE;
            default -> throw new Error("Invalid log level: " + levelName);
        };
        final Logger rootLogger = Logger.getLogger("");
        rootLogger.setLevel(level);
        for (final Handler handler : rootLogger.getHandlers()) {
            handler.setLevel(level);
        }
    }

    /**
     * Get the folder for log files.
     *
     * @return folder for log files
     */
    public String getLogFolder() {
        return logFolder;
    }

    /**
     * Get the files to transfer, from the command line arguments.
     *
     * @return list of files
     */
    public String[] getFileList() {
        return fileList;
    }

    /**
     * Get a parameter from the configuration file.
     *
     * @param name section in the configuration file, and name of the parameter in the section
     * @return value of the parameter, that is mandatory
     */
    public Object getParam(String... name) {
        if (name.length != 2)
            throw new Error("Invalid configuration parameter name: " + String.join(".", name));
        final var section = config.get(name[0]);
        final var value = section == null ? null : section.get(name[1]);
        if (value == null)
            throw new Error("Configuration parameter not found: " + name[0] + "." + name[1]);
        return value;
    }

    /**
     * Get a string parameter from the configuration file.
     *
     * @param name section in the configuration file, and name of the parameter in the section
     * @return value of the parameter, that is mandatory
     */
    public String getParamStr(String... name) {
        return getParam(name).toString();
    }

    /**
     * Get an integer parameter from the configuration file.
     *
     * @param name section in the configuration file, and name of the parameter in the section
     * @return value of the parameter, that is mandatory
     */
    public int getParamInt(String... name) {
        return (Integer) getParam(name);
    }

    /**
     * Get a boolean parameter from the configuration file.
     *
     * @param name section in the configuration file, and name of the parameter in the section
     * @return value of the parameter, that is mandatory
     */
    public Boolean getParamBool(String... name) {
        final Object value = getParam(name);
        return !(value != null && (Boolean) value == false);
    }

    /**
     * Get the path of an item of the project, from the paths file.
     *
     * @param name name of the item in the paths file, or null for the paths file
     * @return absolute path of the item
     */
    public String getPath(final String name) {
        final String subPath = name == null ? PATHS_FILES : paths.get(name);
        return FileSystems.getDefault().getPath(topFolder, subPath).toString();
    }

    /**
     * Add the files to transfer, from the command line arguments, to the transfer spec.
     *
     * @param tSpec transfer spec to modify
     * @param path path of the file list in the transfer spec: {@code paths} (V1) or {@code assets.paths} (V2)
     * @param destination if not null, add the file name as destination
     */
    public void addSources(JSONObject tSpec, String path, String destination) {
        final String[] keys = path.split("\\.");
        JSONObject currentNode = tSpec;
        for (int i = 0; i < keys.length - 1; i++) {
            if (currentNode.has(keys[i])) {
                Object nextNode = currentNode.get(keys[i]);
                if (nextNode instanceof JSONObject) {
                    currentNode = (JSONObject) nextNode;
                } else {
                    throw new IllegalArgumentException("Invalid path in transfer spec: " + path);
                }
            } else {
                throw new IllegalArgumentException("Invalid path in transfer spec: " + path);
            }
        }
        final JSONArray paths = new JSONArray();
        currentNode.put(keys[keys.length - 1], paths);
        for (String file : fileList) {
            JSONObject source = new JSONObject();
            source.put("source", file);
            if (destination != null) {
                source.put("destination", file.substring(file.lastIndexOf('/') + 1));
            }
            paths.put(source);
        }
    }

    /**
     * Find the main folder of the repository: from system property {@code dir_top} if set,
     * else the first folder containing {@code config/paths.yaml}, from the current folder up.
     *
     * @return absolute path of the main folder
     */
    private static String findTopFolder() {
        final String dirTop = System.getProperty(DIR_TOP_PROPERTY);
        if (dirTop != null && !dirTop.isEmpty()) {
            final Path topFolder = Path.of(dirTop).toAbsolutePath();
            if (!Files.isDirectory(topFolder))
                throw new Error("Folder not found: " + topFolder);
            return topFolder.toString();
        }
        for (Path folder = Path.of("").toAbsolutePath(); folder != null; folder = folder.getParent()) {
            if (Files.isRegularFile(folder.resolve(PATHS_FILES)))
                return folder.toString();
        }
        throw new Error("Main folder not found: run from inside the repository, or set " + DIR_TOP_PROPERTY);
    }
}
