CONFIG_TRSDK_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^sdk_root: //p' < $(DIR_TOP)config/paths.yaml)/
TMP_GENERATED=$(DIR_TOP)$(shell sed -n -e 's/^tmpgen: //p' < $(DIR_TOP)config/paths.yaml)/
CONFIG_TRSDK_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^sdk_conf: //p' < $(DIR_TOP)config/paths.yaml)
CONFIG_TRSDK_DIR_GENERIC=$(DIR_TOP)$(shell sed -n -e 's/^trsdk_noarch: //p' < $(DIR_TOP)config/paths.yaml)/
MAIN_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^mainconfig: //p' < $(DIR_TOP)config/paths.yaml)
CONFIG_TRSDK_DIR_ARCH=$(CONFIG_TRSDK_ROOT)$(shell sed -n -e 's/^ *system_type: //p' < $(DIR_TOP)private/config.yaml)/
