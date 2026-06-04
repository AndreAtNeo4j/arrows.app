package app.arrows.intellij

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project

internal fun arrowsNotify(
    project: Project,
    content: String,
    type: NotificationType = NotificationType.INFORMATION,
    title: String = "Arrows",
) {
    NotificationGroupManager.getInstance().getNotificationGroup("Arrows")
        .createNotification(title, content, type).notify(project)
}
