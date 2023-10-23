GLOBAL_PATHS=$(DIR_TOP)config/paths.yaml
GLOBAL_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^mainconfig: //p' < $(GLOBAL_PATHS))
GLOBAL_GENERATED=$(DIR_TOP)$(shell sed -n -e 's/^tmpgen: //p' < $(GLOBAL_PATHS))/
GLOBAL_TRSDK_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^sdk_root: //p' < $(GLOBAL_PATHS))/
GLOBAL_TRSDK_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^sdk_conf: //p' < $(GLOBAL_PATHS))
GLOBAL_TRSDK_NOARCH=$(DIR_TOP)$(shell sed -n -e 's/^trsdk_noarch: //p' < $(GLOBAL_PATHS))/
GLOBAL_TRSDK_ARCH=$(GLOBAL_TRSDK_ROOT)$(shell sed -n -e 's/^ *system_type: //p' < $(DIR_TOP)private/config.yaml)/
T=.tested
