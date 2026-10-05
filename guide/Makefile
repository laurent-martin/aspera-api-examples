ifndef GFM2PDF_DIR
$(error GFM2PDF_DIR is not set)
endif
include $(GFM2PDF_DIR)/pandoc.mak

DIR_TOP=$(CURDIR)/../
include $(DIR_TOP)common.mak
# create template from actual private config file
DOC_TOOL=ruby -I $(DIR_TOP)/guide -r doc -e
$(GBL_FILE_CONF_TMPL): $(GBL_FILE_CONFIG)
	$(DOC_TOOL) generate_config_template $(GBL_FILE_CONFIG) $@
all:: $(GBL_FILE_CONF_TMPL) README.pdf
clean::
	rm -f $(GBL_FILE_CONF_TMPL)
README.pdf: GFM2PDF_ENGINE = latex
pdf: README.pdf
# one image per tab of the drawio file, named after the tab: regenerated only if older than the drawio file
DRAWIO_FILE=images/diagrams.drawio
DRAWIO_OPTIONS=--scale 2 --transparent
include $(GFM2PDF_DIR)/drawio.mak
README.pdf: $(DRAWIO_IMAGES)
