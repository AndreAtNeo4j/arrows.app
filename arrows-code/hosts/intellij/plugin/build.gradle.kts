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
    implementation("org.json:json:20240303")
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
    }
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    buildSearchableOptions = false // no custom settings UI to index
    pluginConfiguration {
        version = "0.1.0"
        ideaVersion {
            sinceBuild = "243"
        }
    }
}

// Ship the shared embed bundle if it has been built (dist/apps/arrows-ts, the
// same artifact the VS Code host bundles). Drop the placeholder when present.
val embedBundle = rootProject.file("../../../dist/apps/arrows-ts")
tasks.processResources {
    if (embedBundle.exists()) {
        exclude("embed/**")
        from(embedBundle) { into("embed") }
    }
}
