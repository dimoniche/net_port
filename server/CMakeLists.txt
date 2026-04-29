cmake_minimum_required(VERSION 3.10)
project(module_net_port_server C)

set(CMAKE_C_STANDARD 11)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

set(VERSION_MAJOR 0)
set(VERSION_MINOR 0)
set(VERSION_PATCH 3)
set(BUILD_REVISION 0)
set(SOFT_VERSION ${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH})
set(MODULE_NAME module_net_port_server)

include(generate_product_version)
generate_product_version(
        VersionFilesOutputVariable
        NAME ${MODULE_NAME}
        VERSION_MAJOR ${VERSION_MAJOR}
        VERSION_MINOR ${VERSION_MINOR}
        VERSION_PATCH ${VERSION_PATCH}
        VERSION_REVISION ${BUILD_REVISION}
)

set(EXEC_NAME ${MODULE_NAME}-${SOFT_VERSION})

# OS detection
if(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    set(PostgreSQL_LIBRARY -lpq)
    set(PostgreSQL_INCLUDE_DIRS "/usr/local/opt/libpq/include")
    set(PostgreSQL_LIBRARY_DIRS "/usr/local/opt/libpq/lib")
else()
    # Assume Linux
    set(PostgreSQL_LIBRARY /usr/lib/x86_64-linux-gnu/libpq.so)
    set(PostgreSQL_INCLUDE_DIRS "/usr/include/postgresql")
    set(PostgreSQL_LIBRARY_DIRS "/usr/lib/x86_64-linux-gnu")
endif()

link_directories(${PostgreSQL_LIBRARY_DIRS})

find_package(OpenSSL REQUIRED)

# feature checks
include(CheckLibraryExists)
check_library_exists(rt clock_gettime "time.h" CONFIG_SYSTEM_HAS_CLOCK_GETTIME)

if(CONFIG_SYSTEM_HAS_CLOCK_GETTIME)
    set(EXTRA_LIBS -lrt)
else()
    set(EXTRA_LIBS "")
endif()

# check if we are on a little or a big endian
include(TestBigEndian)
test_big_endian(PLATFORM_IS_BIGENDIAN)

add_subdirectory(common)

include_directories(
        .
        ${PostgreSQL_INCLUDE_DIRS}
        ${OPENSSL_INCLUDE_DIR}
        ${CMAKE_CURRENT_LIST_DIR}/common/inc
        ${CMAKE_CURRENT_LIST_DIR}/proxy/inc
        ${CMAKE_CURRENT_LIST_DIR}/resources/inc
        ${CMAKE_CURRENT_LIST_DIR}/db/inc
        ${PROJECT_BINARY_DIR}
)

add_executable(${EXEC_NAME}
        main.c
        proxy/server/proxy_server.c
        resources/signal_handler.c
        resources/time_counter.c
        db/db_func.c
)

target_link_libraries(${EXEC_NAME}
        server_proxy_common
        ${EXTRA_LIBS}
        ${OPENSSL_LIBRARIES}
)
