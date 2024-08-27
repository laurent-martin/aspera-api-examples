#pragma once

#define ENUM_TO_STRING_BEGIN(enum_type)                         \
    inline std::string enum_type##_to_string(enum_type value) { \
        switch (value) {
#define ENUM_TO_STRING_ENUM_VALUE(enum_type, enum_value) \
    case enum_type :: enum_value:                      \
        return #enum_value;
#define ENUM_TO_STRING_PREFIX_VALUE(enum_prefix, enum_value) \
    case enum_prefix ## enum_value:                      \
        return #enum_value;
#define ENUM_TO_STRING_END(enum_type)                              \
    default:                                                       \
        return "Unknown " #enum_type ": " + std::to_string(value); \
        }                                                          \
        }
#if 0
// define the enum to string conversion
namespace transfersdk {
ENUM_TO_STRING_BEGIN(TransferStatus)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, UNKNOWN_STATUS)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, QUEUED)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, RUNNING)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, COMPLETED)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, FAILED)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, CANCELED)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, PAUSED)
ENUM_TO_STRING_ENUM_VALUE(TransferStatus, ORPHANED)
ENUM_TO_STRING_END(TransferStatus)
}  // namespace transfersdk
#endif
