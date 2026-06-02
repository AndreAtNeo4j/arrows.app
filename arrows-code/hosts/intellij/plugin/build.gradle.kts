plugins {
    kotlin("jvm")
    id("org.jetbrains.intellij.platform")
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation(project(":protocol"))
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
    }
}

kotlin {
    jvmToolchain(21)
}
