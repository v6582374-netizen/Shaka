cmake_minimum_required(VERSION 3.16)
project(g1_arm_sdk_zero_hold_v5 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)

set(UNITREE_SDK_ROOT /home/unitree/unitree_sdk2)
find_library(UNITREE_SDK_LIBRARY unitree_sdk2
  PATHS "${UNITREE_SDK_ROOT}/lib/${CMAKE_SYSTEM_PROCESSOR}"
  NO_DEFAULT_PATH)
if(NOT UNITREE_SDK_LIBRARY)
  message(FATAL_ERROR "Unitree SDK static library was not found")
endif()

add_library(unitree_sdk2 STATIC IMPORTED GLOBAL)
set_target_properties(unitree_sdk2 PROPERTIES
  IMPORTED_LOCATION "${UNITREE_SDK_LIBRARY}")
target_include_directories(unitree_sdk2 INTERFACE
  "${UNITREE_SDK_ROOT}/include")

set(UNITREE_DDS_ROOT "${UNITREE_SDK_ROOT}/thirdparty")
foreach(component IN ITEMS ddsc ddscxx)
  find_library(${component}_LIBRARY ${component}
    PATHS "${UNITREE_DDS_ROOT}/lib/${CMAKE_SYSTEM_PROCESSOR}"
    NO_DEFAULT_PATH)
  if(NOT ${component}_LIBRARY)
    message(FATAL_ERROR "Unitree ${component} library was not found")
  endif()
  add_library(${component} SHARED IMPORTED GLOBAL)
  set_target_properties(${component} PROPERTIES
    IMPORTED_LOCATION "${${component}_LIBRARY}"
    IMPORTED_NO_SONAME TRUE)
  target_link_libraries(${component} INTERFACE Threads::Threads)
  target_link_directories(${component} INTERFACE
    "${UNITREE_DDS_ROOT}/lib/${CMAKE_SYSTEM_PROCESSOR}")
endforeach()
target_include_directories(ddsc INTERFACE
  "${UNITREE_DDS_ROOT}/include")
target_include_directories(ddscxx INTERFACE
  "${UNITREE_DDS_ROOT}/include"
  "${UNITREE_DDS_ROOT}/include/ddscxx")
target_link_libraries(unitree_sdk2 INTERFACE ddsc ddscxx Threads::Threads)

add_executable(g1_arm_sdk_zero_hold_v5
  ../../scripts/g1_arm_sdk_zero_hold_v5.cpp)
target_link_libraries(g1_arm_sdk_zero_hold_v5 PRIVATE unitree_sdk2)
