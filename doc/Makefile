DIR_TOP=$(CURDIR)/../
include $(DIR_TOP)common.mak
# create template from actual private config file
DOC_TOOL=ruby -I $(DIR_TOP)/doc -r doc -e
$(GBL_FILE_CONF_TMPL): $(GBL_FILE_CONFIG)
	$(DOC_TOOL) generate_config_template $(GBL_FILE_CONFIG) $@
all:: $(GBL_FILE_CONF_TMPL)
clean::
	rm -f $(GBL_FILE_CONF_TMPL)
