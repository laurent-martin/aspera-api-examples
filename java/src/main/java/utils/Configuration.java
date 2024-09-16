package utils;

import java.util.Map;
// import java.util.logging.Logger;
import java.util.Locale;
import java.nio.file.FileSystems;
import org.yaml.snakeyaml.Yaml;

// read configuration file and provide interface for transfer
public class Configuration {
	// private static final Logger LOGGER = Logger.getLogger(Configuration.class.getName());
	static final String PATHS_FILES = "config/paths.yaml";

	// config filer loaded from yaml
	private final String topFolder;
	private final String logFolder;
	private final Map<String, String> paths;
	private Map<String, Map<String, Object>> config;

	public Configuration() {
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

	/// @return true if the value is not null and is true
	public Boolean getParamBool(String... name) {
		final Object value = getParam(name);
		return !(value != null && (Boolean) value == false);
	}

	/// get path from the reference file
	/// if name == null, then we use the default path file
	/// if a name is provided, we use the path from the reference file
	/// @param name the name of the path in the reference file
	/// @param sub_path the sub path to append to the path
	/// @return the path as String
	public String getPath(String name, String... sub_path) {
		// path elements are:
		// - the top folder
		// - the path from the reference file specified by name
		// - additional optional paths
		final String[] completePath = new String[sub_path.length + 1];
		completePath[0] = name == null ? PATHS_FILES : paths.get(name);
		// optional additional paths after the named file path
		System.arraycopy(sub_path, 0, completePath, 1, sub_path.length);
		// concatenate all the path elements, including top folder
		return FileSystems.getDefault().getPath(topFolder, completePath).toString();
	}
}