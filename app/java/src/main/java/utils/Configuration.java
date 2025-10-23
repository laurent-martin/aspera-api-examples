package utils;

import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.Locale;
import java.nio.file.FileSystems;
import java.io.RandomAccessFile;
import java.io.File;
import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;
import org.yaml.snakeyaml.Yaml;
import java.util.stream.Stream;
import java.nio.file.Files;
import java.nio.file.Path;

// read configuration file and provide interface for transfer
public class Configuration {
    private static final Logger LOGGER = Logger.getLogger(Configuration.class.getName());
    private static final String PATHS_FILES = "config/paths.yaml";

    // config filer loaded from yaml
    private final String[] fileList;
    private final String topFolder;
    private final String logFolder;
    private final Map<String, String> paths;
    private Map<String, Map<String, Object>> config;

    public Configuration(String[] args) {
        fileList = args;
        Locale.setDefault(Locale.ENGLISH);
        try {
            topFolder = System.getProperty("dir_top");
            logFolder = System.getProperty("java.io.tmpdir");
            if (topFolder == null)
                throw new Error("mandatory system property not set: dir_top");
            final String paths_config_file = getPath(null);
            paths = new Yaml().load(new java.io.FileReader(paths_config_file));
            final String config_filepath = getPath("main_config");
            config = new Yaml().load(new java.io.FileReader(config_filepath));
        } catch (final java.io.FileNotFoundException e) {
            throw new Error(e.getMessage());
        }
    }

    public String getLogFolder() {
        return logFolder;
    }

    public String[] getFileList() {
        return fileList;
    }

    public Object getParam(String... name) {
        if (name.length != 2)
            throw new Error("invalid configuration parameter name: " + String.join(".", name));
        final var level1 = config.get(name[0]);
        if (level1 == null)
            throw new Error("missing configuration section: " + name[0]);
        final var level2 = level1.get(name[1]);
        if (level2 == null)
            throw new Error("missing configuration parameter: " + name[0] + "." + name[1]);
        return level2;
    }

    public String getParamStr(String... name) {
        return getParam(name).toString();
    }

    public int getParamInt(String... name) {
        return (Integer) getParam(name);
    }

    /** @return true if the value is not null and is true */
    public Boolean getParamBool(String... name) {
        final Object value = getParam(name);
        return !(value != null && (Boolean) value == false);
    }

    /**
     * Get path from the reference file if name == null, then we use the default path file if a name
     * is provided, we use the path from the reference file
     * 
     * @param name the name of the path in the reference file
     * @return the path as String
     */
    public String getPath(final String name) {
        final String subPath = name == null ? PATHS_FILES : paths.get(name);
        return FileSystems.getDefault().getPath(topFolder, subPath).toString();
    }

    public static String lastFileLine2(Path path) throws IOException {
        try (Stream<String> lines = Files.lines(path)) {
            return lines.reduce((first, second) -> second)
                    .orElseThrow(() -> new IOException("Log file is empty"));
        }
    }

    // Get the last line of a file
    public static String lastFileLine(String filePath) {
        LOGGER.log(Level.FINE, "Reading last line of file: {0}", filePath);
        File file = new File(filePath);
        try (RandomAccessFile randomAccessFile = new RandomAccessFile(file, "r")) {
            final long fileLength = randomAccessFile.length();
            if (fileLength == 0) {
                return ""; // Empty file case
            }
            LOGGER.log(Level.FINE, "length: {0}", fileLength);

            // Start from the end of the file (minus one to skip the last byte)
            long pointer = fileLength - 2;
            randomAccessFile.seek(pointer);

            // Read backwards until we find a newline or reach the start of the file
            int readByte;
            while (pointer > 0) {
                readByte = randomAccessFile.readByte();
                if (readByte == '\n') {
                    break; // Found the newline
                }
                pointer--;
                randomAccessFile.seek(pointer); // Move back
            }
            // Now read the last line (either found newline or start of the file)
            var result = randomAccessFile.readLine(); // Read the last line
            return result;
        } catch (final IOException e) {
            throw new Error(e.getMessage());
        }
    }

    /**
     * Fill the transfer spec with the file paths provided on command line
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
                    throw new IllegalArgumentException("key is not a JSONObject: " + keys[i]);
                }
            } else {
                throw new IllegalArgumentException("No such key: " + keys[i]);
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
}
