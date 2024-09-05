package utils;

import java.util.Map;
import java.util.logging.Logger;
import java.util.Locale;
import java.nio.file.FileSystems;
import org.yaml.snakeyaml.Yaml;

// read configuration file and provide interface for transfer
public class Tools {
	private static final Logger LOGGER = Logger.getLogger(Tools.class.getName());
	static final String PATHS_FILES = "config/paths.yaml";

	// config filer loaded from yaml
	private final String dir_top;
	public final String dir_log;
	private final Map<String, String> paths;
	public Map<String, Map<String, Object>> config;

	public Tools() {
		Locale.setDefault(Locale.ENGLISH);
		try {
			dir_top = System.getProperty("dir_top");
			dir_log = System.getProperty("java.io.tmpdir");
			if (dir_top == null)
				throw new Error("mandatory property not set: dir_top");
			final String paths_config_file = getPath(null);
			paths = new Yaml().load(new java.io.FileReader(paths_config_file));
			final String config_filepath = getPath("main_config");
			config = new Yaml().load(new java.io.FileReader(config_filepath));
		} catch (final java.io.FileNotFoundException e) {
			throw new Error(e.getMessage());
		}
	}

	/// get path from the reference file
	/// @param name the name of the path in the reference file
	/// @return the path
	public String getPath(String name, String... sub_path) {
		// by default , we init with the paths reference file
		// if a name is provided, we use the path from the reference file
		final String[] completePath = new String[sub_path.length + 1];
		completePath[0] = name == null ? PATHS_FILES : paths.get(name);
		System.arraycopy(sub_path, 0, completePath, 1, sub_path.length);
		return FileSystems.getDefault().getPath(dir_top, completePath).toString();
	}

}
