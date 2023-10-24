GLOBAL_PATHS=$(DIR_TOP)config/paths.yaml
GLOBAL_TRSDK_NOARCH=$(DIR_TOP)$(shell sed -n -e 's/^trsdk_noarch: //p' < $(GLOBAL_PATHS))/
T=.tested
# flag file that indicates that the folder was initialized
IS_OK=.is_setup
